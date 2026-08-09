import { useState, useCallback } from "react";
import { toast } from "sonner";
import type { Node, Edge } from "@xyflow/react";
import type { Session } from "@supabase/supabase-js";
import {
  deprovisionNode,
  removeNodeFromCanvases,
  type DeprovisionNodeParams,
} from "../../../lib/api";
import { inferServiceType } from "../workspaceHelpers";

interface UseNodeDeletionParams {
  session: Session | null;
  workflowIdRef: React.MutableRefObject<string>;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  isDeploying: boolean;
}

export function useNodeDeletion({
  session,
  workflowIdRef,
  setNodes,
  setEdges,
  isDeploying,
}: UseNodeDeletionParams) {
  const [deletionTarget, setDeletionTarget] = useState<Node | null>(null);
  const [isDeprovisioning, setIsDeprovisioning] = useState(false);

  const handleBeforeDelete = useCallback(
    async ({
      nodes: toDelete,
    }: {
      nodes: Node[];
      edges: Edge[];
    }): Promise<boolean> => {
      const svcNodes = toDelete.filter((n) => n.type === "service");
      if (svcNodes.length === 0) return true;
      if (isDeploying) {
        toast.error("Cannot delete nodes while a deployment is in progress.");
        return false;
      }
      setDeletionTarget(svcNodes[0]);
      return false;
    },
    [isDeploying],
  );

  const handleDeletionConfirm = useCallback(
    async (keepResource = false) => {
      if (!deletionTarget) return;
      const d = deletionTarget.data as any;
      const isImported = !!d.imported;
      const hasCloudResource =
        d.vercelProjectId ||
        d.supabaseProjectRef ||
        d.githubRepoName ||
        d.cfWorkerNameProvisioned ||
        d.cfBucketNameProvisioned;
      if (
        !isImported &&
        !keepResource &&
        (d.status === "provisioned" ||
          (d.status === "provisioning" && hasCloudResource)) &&
        session
      ) {
        setIsDeprovisioning(true);
        try {
          const params: DeprovisionNodeParams = {
            service: inferServiceType(d) ?? "",
            stackId: d.stackId,
            imported: false,
            serviceIds: {
              vercelProjectId: d.vercelProjectId,
              supabaseProjectRef: d.supabaseProjectRef,
              githubRepoName: d.githubRepoName,
              cfWorkerName: d.cfWorkerNameProvisioned,
              cfBucketName: d.cfBucketNameProvisioned,
              cloudflareAccountId: d.cloudflareAccountId,
            },
          };
          await deprovisionNode(
            workflowIdRef.current,
            deletionTarget.id,
            params,
            session,
          );
          toast.success(`${d.label || "Resource"} deleted from cloud`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Only remove from canvas if the resource is genuinely gone (404-style).
          // On real errors (500, 423 locked, network) abort — removing the node
          // would create an orphaned cloud resource invisible to Leenar.
          const isGone = /not found|404|already deleted|does not exist/i.test(
            msg,
          );
          if (!isGone) {
            toast.error(`Failed to delete ${d.label || "resource"}: ${msg}`);
            setIsDeprovisioning(false);
            setDeletionTarget(null);
            return;
          }
          toast.info(
            `${d.label || "Resource"} removed from canvas (cloud resource may already be deleted)`,
          );
          // deprovisionNode returned a 404 — the server endpoint never patched the
          // canvas. Patch it now so the node doesn't reappear on next refresh.
          if (session && workflowIdRef.current) {
            removeNodeFromCanvases(
              workflowIdRef.current,
              deletionTarget.id,
              session,
            ).catch(() => {});
          }
        }
        setIsDeprovisioning(false);
      } else if (isImported) {
        // Imported node — detach from canvas only, cloud resource untouched
        toast.success(`${d.label || "Resource"} removed from canvas`);
      } else if (keepResource && hasCloudResource) {
        toast.success(
          `${d.label || "Resource"} removed from canvas — cloud resource left running`,
        );
        if (session && workflowIdRef.current) {
          // The deprovision call was skipped entirely, so the server-side
          // stack/canvas bookkeeping that a real deprovisionNode call would
          // have done still needs to happen — call it with keepResource so
          // the backend cleans up DB rows without touching the cloud resource.
          const params: DeprovisionNodeParams = {
            service: inferServiceType(d) ?? "",
            stackId: d.stackId,
            imported: false,
            keepResource: true,
            serviceIds: {
              vercelProjectId: d.vercelProjectId,
              supabaseProjectRef: d.supabaseProjectRef,
              githubRepoName: d.githubRepoName,
              cfWorkerName: d.cfWorkerNameProvisioned,
              cfBucketName: d.cfBucketNameProvisioned,
              cloudflareAccountId: d.cloudflareAccountId,
            },
          };
          deprovisionNode(
            workflowIdRef.current,
            deletionTarget.id,
            params,
            session,
          ).catch(() => {});
        }
      }
      // Use setNodes/setEdges directly — deleteElements re-triggers onBeforeDelete
      // which returns false and blocks the deletion (infinite loop)
      const targetId = deletionTarget.id;
      setNodes((nds: Node[]) => nds.filter((n) => n.id !== targetId));
      setEdges((eds: Edge[]) =>
        eds.filter((e) => e.source !== targetId && e.target !== targetId),
      );
      setDeletionTarget(null);
      // For unprovisioned nodes the deprovisionNode API was skipped, so
      // projects.canvas and all project_environments.canvas still hold the
      // deleted node. Patch them now so a refresh or env-switch doesn't
      // bring the node back.
      if (
        session &&
        workflowIdRef.current &&
        (!hasCloudResource || isImported)
      ) {
        removeNodeFromCanvases(workflowIdRef.current, targetId, session).catch(
          () => {},
        );
      }
    },
    [deletionTarget, session, setNodes, setEdges, workflowIdRef],
  );

  const handleDeletionCancel = useCallback(() => {
    setDeletionTarget(null);
    setIsDeprovisioning(false);
  }, []);

  return {
    deletionTarget,
    setDeletionTarget,
    isDeprovisioning,
    handleBeforeDelete,
    handleDeletionConfirm,
    handleDeletionCancel,
  };
}
