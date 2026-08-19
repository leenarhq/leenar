import type { LogEntry, SimpleEdge, SimpleNode } from "./chatTypes";

/** A node the model should be told about. Everything else on the canvas is
 *  chrome as far as a provisioning question is concerned. */
const SERVICE_NODE_TYPES = new Set(["service", "trigger"]);

/**
 * The canvas, written out for the model.
 *
 * This is a prompt, not a view: every line here is read by the assistant and
 * nothing here is read by a user, which is why it is plain text rather than
 * JSON and why it says things like "[NOT synced — deploy needed]" out loud.
 * It lives outside ChatPanel because it is pure — nodes and edges in, a string
 * out — and a pure function is the half of the chat worth testing directly.
 *
 * Only service-to-service edges are counted, so that "(no connections —
 * isolated)" means what it says.
 */
export function buildCanvasContext(
  nodes: SimpleNode[],
  edges: SimpleEdge[] = [],
  opts?: {
    isDeploying?: boolean;
    deployLogs?: LogEntry[];
    workflowName?: string;
    currentEnvName?: string;
    currentEnvIsDefault?: boolean;
    environments?: Array<{ name: string; slug: string; is_default: boolean }>;
  },
): string {
  const serviceNodes = nodes.filter((n) => SERVICE_NODE_TYPES.has(n.type));

  if (serviceNodes.length === 0)
    return "Canvas is empty — no service nodes yet.";

  // Only count service↔service edges so (no connections) is accurate
  const serviceIds = new Set(serviceNodes.map((n) => n.id));
  const serviceEdges = edges.filter(
    (e) => serviceIds.has(e.source) && serviceIds.has(e.target),
  );
  const connectedIds = new Set(
    serviceEdges.flatMap((e) => [e.source, e.target]),
  );

  const nodeLines = serviceNodes
    .map((n) => {
      const d = n.data ?? {};
      const parts: string[] = [`id:${n.id}`, `label:${d.label ?? n.type}`];
      if (d.provider) parts.push(`provider:${String(d.provider)}`);
      const status = d.status as string | undefined;
      if (status && status !== "draft") parts.push(`status:${status}`);
      if (d.errorMsg) parts.push(`errorMsg:${String(d.errorMsg)}`);
      if (d.provisionedUrl) parts.push(`url:${String(d.provisionedUrl)}`);
      if (d.existing_repo) parts.push(`repo:${String(d.existing_repo)}`);
      if (d.projectName) parts.push(`projectName:${String(d.projectName)}`);
      if (d.region) parts.push(`region:${String(d.region)}`);
      if (d.fromEmail) parts.push(`fromEmail:${String(d.fromEmail)}`);
      if (d.senderName) parts.push(`senderName:${String(d.senderName)}`);
      if (!connectedIds.has(n.id)) parts.push("(no connections — isolated)");
      return parts.join(" | ");
    })
    .join("\n");

  let envLine = "";
  if (opts?.currentEnvName) {
    const tag = opts.currentEnvIsDefault ? " (default/production)" : "";
    envLine = `Environment: ${opts.currentEnvName}${tag}`;
    if (opts.environments && opts.environments.length > 1) {
      const others = opts.environments
        .filter((e) => e.name !== opts.currentEnvName)
        .map((e) => e.name)
        .join(", ");
      envLine += ` | Other environments: ${others}`;
    }
    envLine += "\n";
  }

  let ctx = opts?.workflowName
    ? `Workflow: ${opts.workflowName}\n${envLine}Canvas nodes:\n${nodeLines}`
    : `${envLine}Canvas nodes:\n${nodeLines}`;

  if (serviceEdges.length > 0) {
    const edgeLines = serviceEdges
      .map((e) => {
        const srcLabel =
          serviceNodes.find((n) => n.id === e.source)?.data?.label ?? e.source;
        const tgtLabel =
          serviceNodes.find((n) => n.id === e.target)?.data?.label ?? e.target;
        const parts: string[] = [
          `${srcLabel}(${e.source}) → ${tgtLabel}(${e.target})`,
        ];
        if (e.data?.envVars?.length) {
          parts.push(`envVars:${e.data.envVars.join(",")}`);
          parts.push(
            e.data.synced ? "[synced]" : "[NOT synced — deploy needed]",
          );
        } else {
          parts.push("[config edge — no env vars]");
        }
        return parts.join(" | ");
      })
      .join("\n");
    ctx += `\n\nCanvas edges:\n${edgeLines}`;
  } else {
    ctx += "\n\nCanvas edges: none";
  }

  if (opts?.isDeploying !== undefined) {
    ctx += `\n\n[provision status] deploying:${opts.isDeploying}`;
  }

  if (opts?.deployLogs?.length) {
    const recent = opts.deployLogs.slice(-10);
    const logLines = recent
      .map((l) => `[${l.type}] ${l.source}: ${l.msg}`)
      .join("\n");
    ctx += `\n\n[deploy logs]\n${logLines}`;
  }

  return ctx;
}
