import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SettingsShell, SettingsHeader } from "../components/settings-shell";
import {
  Rows,
  Row,
  RowHead,
  Mono,
  Dim,
  ROW_HEAD_WIDE_ONLY,
} from "../components/console/Rows";
import { useAuth } from "../context/auth";
import { fetchAuditLog } from "../lib/api";
import { isCloud } from "../lib/cloud";
import { timeAgo } from "../lib/utils";

/* Kept literal so Tailwind's scanner sees it, and declared once because the
   header and the rows have to agree — they were two copies of this string. */
const COLS = "sm:grid-cols-[1.5fr_2fr_1fr]";

export const Route = createFileRoute("/console/settings/activity")({
  component: ActivityPage,
  head: () => ({ meta: [{ title: "Activity — Leenar Console" }] }),
});

function humanize(event: string): string {
  const words = event.split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Turns an audit event code + its metadata blob into a short, readable
 * sentence for end users (no raw JSON).
 */
function formatAuditDetails(
  event: string,
  metadata: Record<string, unknown>,
): string {
  const str = (key: string): string | undefined => {
    const v = metadata[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const num = (key: string): number | undefined => {
    const v = metadata[key];
    return typeof v === "number" ? v : undefined;
  };

  const stackName = str("stackName") ?? str("name");
  const workflowName = str("workflowName") ?? str("name");
  const provider = str("provider") ?? str("service");

  switch (event) {
    case "deploy_started":
      return stackName
        ? `Started deployment of "${stackName}"`
        : "Started a deployment";
    case "deploy_cancelled":
      return "Cancelled a deployment";
    case "deploy_failed": {
      const err = str("error");
      return err ? `Deployment failed: ${err}` : "Deployment failed";
    }
    case "deploy_completed": {
      const n = num("nodeCount");
      return n != null
        ? `Deployment completed (${n} service${n === 1 ? "" : "s"})`
        : "Deployment completed";
    }
    case "deploy_teardown": {
      const removed = num("removed");
      return removed != null
        ? `Tore down ${removed} resource${removed === 1 ? "" : "s"}`
        : "Tore down deployment resources";
    }
    case "deploy_rolled_back":
      return "Rolled back to a previous deployment";
    case "stack_created":
      return stackName ? `Created stack "${stackName}"` : "Created a stack";
    case "stack_updated": {
      const fields = metadata["fields"];
      const fieldList = Array.isArray(fields) ? fields.join(", ") : undefined;
      return fieldList ? `Updated stack (${fieldList})` : "Updated a stack";
    }
    case "stack_deleted":
      return "Deleted a stack";
    case "workflow_created":
      return workflowName
        ? `Created workflow "${workflowName}"`
        : "Created a workflow";
    case "workflow_setup": {
      const services = num("services");
      return workflowName
        ? `Set up workflow "${workflowName}"${services != null ? ` with ${services} service${services === 1 ? "" : "s"}` : ""}`
        : "Set up a workflow";
    }
    case "workflow_deleted":
      return "Deleted a workflow";
    case "canvas_updated":
      return "Updated the canvas layout";
    case "integration_connected":
      return provider
        ? `Connected ${titleCase(provider)} account`
        : "Connected an integration";
    case "integration_disconnected":
      return provider
        ? `Disconnected ${titleCase(provider)} account`
        : "Disconnected an integration";
    case "webhook_created":
      return "Created a webhook";
    case "webhook_deleted":
      return "Deleted a webhook";
    case "drift_ignored":
      return "Ignored a configuration drift";
    case "drift_reconciled": {
      const svc = str("service");
      return svc
        ? `Reconciled drift on ${titleCase(svc)}`
        : "Reconciled a configuration drift";
    }
    case "incident_acknowledged":
      return "Acknowledged an incident";
    case "incident_resolved":
      return "Resolved an incident";
    case "node_updated": {
      const fields = metadata["fields"];
      const fieldList = Array.isArray(fields) ? fields.join(", ") : undefined;
      return fieldList ? `Updated a node (${fieldList})` : "Updated a node";
    }
    case "node_removed":
      return "Removed a node";
    case "node_imported":
      return provider
        ? `Imported ${titleCase(provider)} node`
        : "Imported a node";
    case "edge_env_vars_set": {
      const added = metadata["added"];
      const addedList = Array.isArray(added) ? added.join(", ") : undefined;
      return addedList
        ? `Set env vars on a connection (${addedList})`
        : "Set env vars on a connection";
    }
    case "edge_removed":
      return "Removed a connection between services";
    default:
      return humanize(event);
  }
}

function ActivityPage() {
  const { session } = useAuth();
  // /api/audit-log is a cloud-only router. The nav item is hidden in core
  // (settings-shell), but the route still exists, so don't fire a request that
  // can only 404 — render the empty state instead.
  const query = useQuery({
    queryKey: ["audit-log"],
    queryFn: () =>
      session ? fetchAuditLog(session, { limit: 100 }) : Promise.resolve([]),
    enabled: !!session && isCloud,
  });
  const entries = query.data ?? [];

  return (
    <SettingsShell title="Activity">
      <div className="flex-1 p-5 sm:p-8">
        <SettingsHeader subtitle="A log of security-relevant actions on your account." />
        <div className="mt-4">
          <Rows>
            <RowHead className={ROW_HEAD_WIDE_ONLY}>
              <div className={`grid w-full gap-4 ${COLS}`}>
                <div>event</div>
                <div>details</div>
                <div>when</div>
              </div>
            </RowHead>
            <div className="max-h-[60vh] overflow-y-auto">
              {query.isLoading ? (
                <div className="px-4 py-12 text-center text-[13px] text-muted-foreground">
                  Loading…
                </div>
              ) : entries.length === 0 ? (
                <div className="px-4 py-16 text-center text-[13px] text-muted-foreground">
                  No activity recorded.
                </div>
              ) : (
                entries.map((e) => (
                  <Row key={e.id}>
                    <div
                      className={`grid w-full grid-cols-1 gap-1 sm:items-center sm:gap-4 ${COLS}`}
                    >
                      <Mono>{e.event}</Mono>
                      {/* `truncate` only above the breakpoint: stacked, the
                          details line has the full width and should use it
                          rather than clip mid-sentence. */}
                      <div className="text-[12px] text-muted-foreground sm:truncate">
                        {formatAuditDetails(e.event, e.metadata)}
                        {e.ip ? ` · ${e.ip}` : ""}
                      </div>
                      <Dim>{timeAgo(new Date(e.created_at).getTime())}</Dim>
                    </div>
                  </Row>
                ))
              )}
            </div>
          </Rows>
        </div>
      </div>
    </SettingsShell>
  );
}
