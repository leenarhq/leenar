import { useEffect, useRef } from "react";
import type { Node } from "@xyflow/react";
import { toast } from "sonner";
import type { Session } from "@supabase/supabase-js";
import { getWorkflowUsage } from "../../../lib/api";
import { isTabHidden } from "../../../lib/visibility";
import { runUsageAlerts, MAX_HISTORY, type UsageReading } from "./usageAlerts";

const SUPABASE_DB_LIMIT = 500 * 1024 * 1024; // 500 MB
const SUPABASE_MAU_LIMIT = 50_000;
const WARN_THRESHOLD = 0.8;
const POLL_MS = 5 * 60_000; // 5 minutes

interface UseUsageMonitoringProps {
  workflowId: string;
  nodes: Node[];
  session: Session | null;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  /** Off in self-host builds: /api/usage is a cloud-only router. */
  enabled?: boolean;
}

export function useUsageMonitoring({
  workflowId,
  nodes,
  session,
  setNodes,
  enabled = true,
}: UseUsageMonitoringProps) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nodesRef = useRef(nodes);
  const historyRef = useRef<Map<string, UsageReading[]>>(new Map());
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    if (!enabled || workflowId === "new" || !session) return;

    const hasProvisioned = nodesRef.current.some(
      (n) => (n.data as any)?.status === "provisioned",
    );
    if (!hasProvisioned) return;

    const fetchUsage = async () => {
      try {
        const data = await getWorkflowUsage(workflowId, session);
        if (!data.usage || Object.keys(data.usage).length === 0) return;

        setNodes((nds) =>
          nds.map((node) => {
            const u = data.usage[node.id];
            if (!u) return node;
            return { ...node, data: { ...node.data, usage: u } };
          }),
        );

        // Quota warnings + trend alerts
        for (const [nodeId, u] of Object.entries(data.usage)) {
          const node = nodesRef.current.find((n) => n.id === nodeId);
          const label = (node?.data as any)?.label ?? nodeId;

          if (u.db_size !== undefined) {
            const pct = u.db_size / SUPABASE_DB_LIMIT;
            if (pct >= WARN_THRESHOLD) {
              toast.warning(
                `${label}: Supabase DB at ${Math.round(pct * 100)}% of 500 MB free limit`,
                { id: `quota-${nodeId}-db` },
              );
            }
          }

          if (u.mau !== undefined) {
            const pct = u.mau / SUPABASE_MAU_LIMIT;
            if (pct >= WARN_THRESHOLD) {
              toast.warning(
                `${label}: Supabase MAU at ${Math.round(pct * 100)}% of 50K free limit`,
                { id: `quota-${nodeId}-mau` },
              );
            }
          }

          // Trend-based alerts (anomaly, predictive billing, smart quota)
          const reading: UsageReading = {
            db_size: u.db_size,
            mau: u.mau,
            timestamp: Date.now(),
          };
          const history = historyRef.current.get(nodeId) ?? [];
          runUsageAlerts(nodeId, label, reading, history);
          historyRef.current.set(
            nodeId,
            [...history, reading].slice(-MAX_HISTORY),
          );
        }
      } catch {
        /* silently ignore — usage is non-critical */
      }
    };

    fetchUsage();
    timerRef.current = setInterval(() => {
      if (isTabHidden()) return;
      fetchUsage();
    }, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, session, enabled]);
}
