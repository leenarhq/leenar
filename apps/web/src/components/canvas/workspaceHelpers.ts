import type { Node, Edge } from "@xyflow/react";
import type { ProvisioningStep } from "../../lib/workflows";
import type { LogEntry } from "../../lib/types";

export const LABEL_TO_SERVICE: Record<string, string> = {
  github: "github",
  vercel: "vercel",
  supabase: "supabase",
  resend: "resend",
  cloudflare: "cloudflare",
};

export function inferServiceType(data: Record<string, unknown>): string | null {
  const provider = (data.provider as string | undefined)?.toLowerCase();

  if (provider === "cloudflare") {
    const sub = (data.cloudflareService as string | undefined)?.toLowerCase();
    return sub === "r2" ? "cloudflare-r2" : "cloudflare-workers";
  }

  if (provider && LABEL_TO_SERVICE[provider]) return LABEL_TO_SERVICE[provider];
  const label = (data.label as string | undefined)?.toLowerCase() ?? "";
  for (const key of Object.keys(LABEL_TO_SERVICE)) {
    if (label.includes(key)) return key;
  }
  return null;
}

export function nowTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

export function stepsToNewLogs(
  prev: ProvisioningStep[],
  curr: ProvisioningStep[],
): LogEntry[] {
  const logs: LogEntry[] = [];
  const time = nowTime();
  curr.forEach((step, i) => {
    if (!prev[i] || prev[i].status !== step.status) {
      if (step.status === "running") {
        logs.push({
          time,
          source: step.name,
          msg: `Provisioning ${step.name}…`,
          type: "info",
        });
      } else if (step.status === "success") {
        const url = step.output
          ? Object.values(step.output).find((v) => v?.startsWith("http"))
          : undefined;
        logs.push({
          time,
          source: step.name,
          msg: `✓ ${step.name} ready${url ? ` → ${url}` : ""}`,
          type: "success",
        });
      } else if (step.status === "error") {
        logs.push({
          time,
          source: step.name,
          msg: `✗ ${step.name}: ${step.error ?? "unknown error"}`,
          type: "error",
        });
      }
    }
  });
  return logs;
}

/**
 * Auto-layout: assigns positions using a left-to-right topological sort.
 * Department/group nodes are excluded from the algorithm and kept in place.
 * Returns a new nodes array with updated positions (does not mutate input).
 */
export function applyAutoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const COL_GAP = 400;
  const ROW_GAP = 200;
  const START_X = 80;
  const START_Y = 80;

  // Only layout service/trigger/logic nodes — skip department containers
  const layoutNodes = nodes.filter(
    (n) => n.type !== "department" && !n.parentId,
  );
  const fixed = nodes.filter((n) => n.type === "department" || n.parentId);

  if (layoutNodes.length === 0) return nodes;

  const ids = new Set(layoutNodes.map((n) => n.id));

  // Build adjacency + in-degree (only considering layout nodes)
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of layoutNodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }

  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }
  }

  // Kahn's BFS → topo levels
  const levels = new Map<string, number>();
  const queue = layoutNodes
    .filter((n) => inDegree.get(n.id) === 0)
    .map((n) => n.id);
  queue.forEach((id) => levels.set(id, 0));

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    for (const next of adj.get(cur) ?? []) {
      const lvl = (levels.get(cur) ?? 0) + 1;
      if (!levels.has(next) || levels.get(next)! < lvl) levels.set(next, lvl);
      inDegree.set(next, inDegree.get(next)! - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  // Nodes not reached (cycles) → append at end
  let maxLevel = 0;
  for (const l of levels.values()) if (l > maxLevel) maxLevel = l;
  for (const n of layoutNodes) {
    if (!levels.has(n.id)) levels.set(n.id, ++maxLevel);
  }

  // Group by level → assign (x, y)
  const byLevel = new Map<number, string[]>();
  for (const [id, lvl] of levels) {
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(id);
  }

  const posMap = new Map<string, { x: number; y: number }>();
  for (const [lvl, ids] of byLevel) {
    const x = START_X + lvl * COL_GAP;
    ids.forEach((id, row) => {
      const totalH = ids.length * ROW_GAP;
      const y = START_Y + row * ROW_GAP - totalH / 2 + 300;
      posMap.set(id, { x, y });
    });
  }

  return nodes.map((n) => {
    const pos = posMap.get(n.id);
    if (!pos) return n;
    return { ...n, position: pos };
  });
}

export const SERVICE_DISPLAY: Record<string, { label: string; color: string }> =
  {
    github: { label: "GitHub", color: "#e2e8f0" },
    vercel: { label: "Vercel", color: "#e2e8f0" },
    supabase: { label: "Supabase", color: "#3ecf8e" },
    resend: { label: "Resend", color: "#f97316" },
    cloudflare: { label: "Cloudflare", color: "#f6821f" },
    "cloudflare-workers": { label: "Cloudflare Workers", color: "#f6821f" },
    "cloudflare-r2": { label: "Cloudflare R2", color: "#f6821f" },
  };
