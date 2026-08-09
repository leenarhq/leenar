import type { DashboardData } from "../hooks/useProjectDashboard";
import { buildActivityFeed } from "./activity";

export function buildDashboardContext(data: DashboardData): string {
  const name = data.summary?.name ?? "Unknown project";
  const lastDeploy = data.deployments?.[0];

  const lines: string[] = [
    `[Dashboard State for project: ${name}]`,
    `Project status: ${data.summary?.status ?? "unknown"}`,
    `Last deploy: ${lastDeploy ? `${lastDeploy.status} at ${lastDeploy.queued_at}` : "none"}`,
  ];

  // Services from canvas nodes
  const nodes = (data.canvas as any)?.nodes ?? [];
  const serviceNodes = nodes.filter(
    (n: any) => n.type === "service" || n.type === "trigger",
  );
  if (serviceNodes.length > 0) {
    lines.push(`Services (${serviceNodes.length}):`);
    for (const n of serviceNodes) {
      const d = n.data ?? {};
      const parts = [`  - ${d.label ?? n.type}`];
      if (d.provider) parts.push(`provider:${d.provider}`);
      if (d.status && d.status !== "draft") parts.push(`status:${d.status}`);
      if (d.errorMsg) parts.push(`error:${d.errorMsg}`);
      lines.push(parts.join(" | "));
    }
  }

  // Recent deployments (last 5)
  const recentDeploys = (data.deployments ?? []).slice(0, 5);
  if (recentDeploys.length > 0) {
    lines.push(`Recent deployments:`);
    for (const d of recentDeploys) {
      lines.push(`  - ${d.status} at ${d.queued_at}`);
    }
  }

  // Open drifts
  const openDrifts = data.drifts ?? [];
  if (openDrifts.length > 0) {
    lines.push(`Open drifts (${openDrifts.length}):`);
    for (const dr of openDrifts) {
      lines.push(
        `  - [${dr.id}] ${dr.service} | ${dr.drift_type} | field:${dr.field}`,
      );
    }
  }

  // Open incidents
  const openIncidents = (data.incidents ?? []).filter(
    (i) => i.status === "open" || i.status === "acknowledged",
  );
  if (openIncidents.length > 0) {
    lines.push(`Open incidents (${openIncidents.length}):`);
    for (const inc of openIncidents) {
      lines.push(
        `  - [${inc.id}] ${inc.service} | ${inc.severity} | ${inc.path ?? "unknown path"} | status:${inc.status}`,
      );
    }
  }

  // Health
  const unhealthy = (data.health ?? []).filter((h) => !h.alive);
  if (unhealthy.length > 0) {
    lines.push(`Unhealthy nodes: ${unhealthy.map((h) => h.nodeId).join(", ")}`);
  }

  // Usage summary
  const usageEntries = Object.entries(data.usage ?? {});
  if (usageEntries.length > 0) {
    lines.push(`Usage:`);
    for (const [nodeId, u] of usageEntries) {
      const parts = [`  - node:${nodeId}`];
      if (u.lastDeploy) parts.push(`lastDeploy:${u.lastDeploy.state}`);
      if (u.db_size != null)
        parts.push(`db_size:${(u.db_size / 1024 / 1024).toFixed(1)}MB`);
      if (u.mau != null) parts.push(`mau:${u.mau}`);
      lines.push(parts.join(" | "));
    }
  }

  // Uptime
  const uptimeEntries = Object.entries(data.uptime ?? {});
  if (uptimeEntries.length > 0) {
    lines.push(`Uptime (7d):`);
    for (const [nodeId, u] of uptimeEntries) {
      const node = serviceNodes.find((n: any) => n.id === nodeId);
      const label = node?.data?.label ?? nodeId;
      const pct = (u.uptime7d * 100).toFixed(1);
      const latency =
        u.lastLatencyMs != null ? ` | latency:${u.lastLatencyMs}ms` : "";
      lines.push(`  - ${label}: ${u.status} | uptime7d:${pct}%${latency}`);
    }
  }

  // Cost
  if (data.cost) {
    lines.push(`Cost this month: $${data.cost.totalThisMonth.toFixed(2)}`);
    for (const [provider, c] of Object.entries(data.cost.byProvider)) {
      const est = c.isEstimate ? " (estimate)" : "";
      lines.push(`  - ${provider}: $${c.thisMonth.toFixed(2)}${est}`);
    }
  }

  // Observability metrics
  if (data.observability) {
    const obs = data.observability;
    if (obs.cloudflare) {
      lines.push(
        `Cloudflare (24h): requests:${obs.cloudflare.requests24h.toLocaleString()} | errorRate:${(obs.cloudflare.errorRate * 100).toFixed(1)}% | cpuP50:${obs.cloudflare.cpuP50Ms}ms | cpuP99:${obs.cloudflare.cpuP99Ms}ms`,
      );
    }
    if (obs.vercel) {
      lines.push(
        `Vercel (7d): deploySuccessRate:${(obs.vercel.successRate7d * 100).toFixed(0)}% | totalDeploys:${obs.vercel.totalDeploys7d} | avgBuildTime:${(obs.vercel.avgBuildMs / 1000).toFixed(1)}s`,
      );
    }
    if (obs.supabase) {
      lines.push(
        `Supabase: status:${obs.supabase.projectStatus} | region:${obs.supabase.region}`,
      );
    }
  }

  // --- Pre-computed correlation signals ---

  // Signal 1: Deploy → Incident correlation
  const firstOpenIncident = openIncidents[0];
  if (lastDeploy && firstOpenIncident) {
    const deployMs = new Date(lastDeploy.queued_at).getTime();
    const incidentMs = new Date(firstOpenIncident.last_seen_at).getTime();
    const gapMin = Math.round((incidentMs - deployMs) / 60_000);
    if (gapMin >= 0 && gapMin <= 120) {
      const deployAgo = Math.round((Date.now() - deployMs) / 60_000);
      lines.push(
        `⚠ SIGNAL: Deploy ${deployAgo}m ago may have caused the open ${firstOpenIncident.service} incident (incident last seen ${gapMin}m after deploy) — possible regression`,
      );
    }
  }

  // Signal 2: Cloudflare error rate classification
  if (data.observability?.cloudflare) {
    const er = data.observability.cloudflare.errorRate;
    let erLabel = "";
    if (er > 0.05) erLabel = "CRITICAL";
    else if (er > 0.02) erLabel = "HIGH";
    else if (er >= 0.005) erLabel = "ELEVATED";
    if (erLabel) {
      lines.push(
        `⚠ SIGNAL: Cloudflare error rate ${(er * 100).toFixed(1)}% is ${erLabel} (normal threshold <0.5%)`,
      );
    }
  }

  // Signal 3: Cost trend (last 7d avg vs prior 7d avg)
  if (data.cost) {
    const allDaily = Object.values(data.cost.byProvider).flatMap(
      (p) => p.daily,
    );
    const byDate: Record<string, number> = {};
    for (const entry of allDaily) {
      byDate[entry.date] = (byDate[entry.date] ?? 0) + entry.amount;
    }
    const sorted = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
    if (sorted.length >= 8) {
      const half = Math.floor(sorted.length / 2);
      const recent = sorted.slice(-half);
      const prior = sorted.slice(0, half);
      const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
      const priorAvg = prior.reduce((s, v) => s + v, 0) / prior.length;
      if (priorAvg > 0) {
        const pct = Math.round(((recentAvg - priorAvg) / priorAvg) * 100);
        if (Math.abs(pct) >= 10) {
          const dir = pct > 0 ? "+" : "";
          lines.push(
            `⚠ SIGNAL: Cost trend ${dir}${pct}% vs prior period ($${priorAvg.toFixed(2)} → $${recentAvg.toFixed(2)}/day avg)`,
          );
        }
      }
    }
  }

  // Signal 4: Uptime classification
  for (const [nodeId, u] of uptimeEntries) {
    const node = serviceNodes.find((n: any) => n.id === nodeId);
    const label = node?.data?.label ?? nodeId;
    if (u.uptime7d < 0.95) {
      lines.push(
        `⚠ SIGNAL: ${label} uptime ${(u.uptime7d * 100).toFixed(1)}% is CRITICAL (threshold 95%)`,
      );
    } else if (u.uptime7d < 0.99) {
      lines.push(
        `⚠ SIGNAL: ${label} uptime ${(u.uptime7d * 100).toFixed(1)}% is DEGRADED (threshold 99%)`,
      );
    }
  }

  // Recent activity feed (last 10 items)
  const activityItems = buildActivityFeed({
    deployments: data.deployments ?? [],
    drifts: data.drifts ?? [],
    incidents: data.incidents ?? [],
    environments: data.environments ?? [],
  });
  if (activityItems.length > 0) {
    lines.push(`Recent activity (last ${activityItems.length}):`);
    for (const item of activityItems) {
      lines.push(`  - [${item.tone}] ${item.label} at ${item.ts}`);
    }
  }

  return lines.join("\n");
}
