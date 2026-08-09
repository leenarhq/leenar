import { useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";

export function useSelectedNodeRelations(
  selectedNode: Node | null,
  nodes: Node[],
  edges: Edge[],
) {
  const connectedGithub = useMemo(() => {
    if (!selectedNode || (selectedNode.data as any)?.provider !== "vercel")
      return false;
    return edges.some((e) => {
      const isGithubToVercel =
        e.target === selectedNode.id &&
        (nodes.find((n) => n.id === e.source)?.data as any)?.provider ===
          "github";
      const isVercelToGithub =
        e.source === selectedNode.id &&
        (nodes.find((n) => n.id === e.target)?.data as any)?.provider ===
          "github";
      return isGithubToVercel || isVercelToGithub;
    });
  }, [selectedNode, edges, nodes]);

  const connectedResend = useMemo(() => {
    if (!selectedNode || (selectedNode.data as any)?.provider !== "supabase")
      return false;
    return edges.some((e) => {
      const isResendToSupabase =
        e.target === selectedNode.id &&
        (nodes.find((n) => n.id === e.source)?.data as any)?.provider ===
          "resend";
      const isSupabaseToResend =
        e.source === selectedNode.id &&
        (nodes.find((n) => n.id === e.target)?.data as any)?.provider ===
          "resend";
      return isResendToSupabase || isSupabaseToResend;
    });
  }, [selectedNode, edges, nodes]);

  return { connectedGithub, connectedResend };
}
