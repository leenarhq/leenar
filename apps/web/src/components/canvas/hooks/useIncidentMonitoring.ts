import { useEffect } from "react";
import type { Node } from "@xyflow/react";
import type { Session } from "@supabase/supabase-js";
import { listOpenIncidents, type Incident } from "../../../lib/api";
import { isTabHidden } from "../../../lib/visibility";

interface UseIncidentMonitoringProps {
  workflowId: string;
  nodes: Node[];
  session: Session | null;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  enabled?: boolean;
}

export function useIncidentMonitoring({
  workflowId,
  nodes,
  session,
  setNodes,
  enabled = true,
}: UseIncidentMonitoringProps) {
  // Derive a primitive that only flips when provisioned-status actually changes.
  // Depending on the `nodes` array directly would re-run the effect on every
  // setNodes (the poll below maps nodes into a new array reference each time),
  // causing a back-to-back incidents-polling loop.
  const hasProvisioned = nodes.some(
    (n) => (n.data as any)?.status === "provisioned",
  );

  useEffect(() => {
    if (!enabled || workflowId === "new" || !session || !hasProvisioned) return;

    let cancelled = false;

    const poll = () => {
      listOpenIncidents(workflowId, session)
        .then((incidents) => {
          if (cancelled) return;

          // Group incidents by Vercel resource_id → map to node via vercelProjectId
          const byResource = new Map<string, Incident[]>();
          for (const inc of incidents) {
            const list = byResource.get(inc.resource_id) ?? [];
            list.push(inc);
            byResource.set(inc.resource_id, list);
          }

          setNodes((nds) =>
            nds.map((n) => {
              const resourceId = ((n.data as any).vercelProjectId ??
                (n.data as any).cfWorkerNameProvisioned) as string | undefined;
              const nodeIncidents: Incident[] = resourceId
                ? (byResource.get(resourceId) ?? [])
                : [];
              const count = nodeIncidents.length;
              const current = (n.data as any).incidentCount ?? 0;
              if (
                count === current &&
                JSON.stringify((n.data as any).incidents) ===
                  JSON.stringify(nodeIncidents)
              )
                return n;
              return {
                ...n,
                data: {
                  ...n.data,
                  incidentCount: count,
                  incidents: nodeIncidents,
                },
              };
            }),
          );
        })
        .catch(() => {
          /* non-critical */
        });
    };

    poll();
    const interval = setInterval(() => {
      if (isTabHidden()) return;
      poll();
    }, 2 * 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [workflowId, session, hasProvisioned, setNodes, enabled]);
}
