// Single source of truth for user-facing product terminology.
// Backend/DB identifiers (workflows/stacks/nodes/edges/provider) are unchanged;
// this maps them to the words users actually see.

export const NOUNS = {
  project: "Project",
  service: "Service",
  connection: "Connection",
} as const;

const STATUS_LABELS: Record<string, "Draft" | "Live" | "Needs attention"> = {
  draft: "Draft",
  active: "Live",
  error: "Needs attention",
};

export function statusLabel(
  status: string,
): "Draft" | "Live" | "Needs attention" {
  return STATUS_LABELS[status] ?? "Draft";
}

const STATUS_TONES: Record<string, "neutral" | "positive" | "warning"> = {
  draft: "neutral",
  active: "positive",
  error: "warning",
};

export function statusTone(status: string): "neutral" | "positive" | "warning" {
  return STATUS_TONES[status] ?? "neutral";
}
