import { useEffect, useRef } from "react";
import type { Node } from "@xyflow/react";
import type { Session } from "@supabase/supabase-js";
import { listDrifts } from "../../../lib/api";

interface UseDriftMonitoringProps {
  workflowId: string;
  nodes: Node[];
  session: Session | null;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
}

export function useDriftMonitoring({
  workflowId,
  nodes,
  session,
  setNodes,
}: UseDriftMonitoringProps) {
  // Latest nodes read inside the event-driven refresh without re-subscribing the
  // listener on every render.
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Primitive that flips false→true once any node is provisioned. Depending on it
  // (instead of the whole `nodes` array) re-runs this effect exactly when the
  // project first has something to reconcile — e.g. after env node states load on
  // reload, or after a deploy completes — without a per-render polling loop.
  const hasProvisioned = nodes.some(
    (n) =>
      (n.data as { status?: string } | undefined)?.status === "provisioned",
  );

  useEffect(() => {
    if (workflowId === "new" || !session) return;

    let cancelled = false;

    function refresh() {
      if (cancelled) return;
      // Nothing to reconcile until at least one node is provisioned. Checked here
      // (not as an early return before the listener is attached) so the listener
      // is ALWAYS registered — otherwise a project with no provisioned nodes at
      // mount would never react to a later drift-check-complete event.
      const provisioned = nodesRef.current.some(
        (n) =>
          (n.data as { status?: string } | undefined)?.status === "provisioned",
      );
      if (!provisioned) return;

      listDrifts(workflowId, session!)
        .then((drifts) => {
          if (cancelled) return;

          // Count open drifts per node
          const countsByNode = new Map<string, number>();
          for (const drift of drifts) {
            countsByNode.set(
              drift.node_id,
              (countsByNode.get(drift.node_id) ?? 0) + 1,
            );
          }

          // driftCount is a runtime-only field; authoringKey ignores it, so this
          // never triggers an auto-save.
          setNodes((nds) =>
            nds.map((n) => {
              const count = countsByNode.get(n.id) ?? 0;
              const current =
                (n.data as { driftCount?: number }).driftCount ?? 0;
              if (count === current) return n;
              return { ...n, data: { ...n.data, driftCount: count } };
            }),
          );
        })
        .catch(() => {
          /* drift fetch failure is non-critical */
        });
    }

    refresh();

    // Re-fetch when a drift check or reconcile completes anywhere on the page.
    window.addEventListener("drift-check-complete", refresh);

    return () => {
      cancelled = true;
      window.removeEventListener("drift-check-complete", refresh);
    };
    // hasProvisioned re-runs the effect when the project first gains a provisioned
    // node; setNodes is stable. Reading `nodes` directly here would loop.
  }, [workflowId, session, hasProvisioned, setNodes]);
}
