import {
  Network,
  Gauge,
  CloudUpload,
  LineChart,
  ScrollText,
  Database,
  type LucideIcon,
} from "lucide-react";

export type RailKey =
  | "canvas"
  | "database"
  | "overview"
  | "deployments"
  | "observability"
  | "logs";

export type RailItem = {
  key: RailKey;
  label: string;
  to:
    | "/console/projects/$id/canvas"
    | "/console/projects/$id/database"
    | "/console/projects/$id/overview"
    | "/console/projects/$id/deployments"
    | "/console/projects/$id/logs"
    | "/console/projects/$id/service-logs";
  icon: LucideIcon;
};

// Overview (Manage) only appears once the project is Live — mirrors the
// previous Manage-tab gating in ProjectLayout.
export function projectRailItems(isLive: boolean): RailItem[] {
  const items: RailItem[] = [
    {
      key: "canvas",
      label: "Canvas",
      to: "/console/projects/$id/canvas",
      icon: Network,
    },
    {
      key: "database",
      label: "Database",
      to: "/console/projects/$id/database",
      icon: Database,
    },
  ];
  if (isLive) {
    items.push({
      key: "overview",
      label: "Overview",
      to: "/console/projects/$id/overview",
      icon: Gauge,
    });
  }
  items.push(
    {
      key: "deployments",
      label: "Deployments",
      to: "/console/projects/$id/deployments",
      icon: CloudUpload,
    },
    {
      key: "observability",
      label: "Observability",
      to: "/console/projects/$id/logs",
      icon: LineChart,
    },
    {
      key: "logs",
      label: "Logs",
      to: "/console/projects/$id/service-logs",
      icon: ScrollText,
    },
  );
  return items;
}

// Substring match is safe because paths are prefixed with the project id, and
// `${base}/logs` is NOT a substring of `${base}/service-logs` (the segment is
// "service-logs", not "/logs").
export function isRailItemActive(
  pathname: string,
  projectId: string,
  key: RailKey,
): boolean {
  const base = `/console/projects/${projectId}`;
  switch (key) {
    case "canvas":
      return pathname.includes(`${base}/canvas`);
    case "database":
      return pathname.includes(`${base}/database`);
    case "overview":
      return pathname.includes(`${base}/overview`);
    case "deployments":
      return pathname.includes(`${base}/deployments`);
    case "observability":
      return pathname.includes(`${base}/logs`);
    case "logs":
      return pathname.includes(`${base}/service-logs`);
  }
}
