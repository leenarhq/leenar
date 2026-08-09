import type { ReactFlowJsonObject } from "@xyflow/react";

export interface CloudResource {
  /** "vercel" | "supabase" | "cloudflare-workers" | "cloudflare-r2" */
  service: string;
  /** Human-readable node label, falls back to provider name. */
  label: string;
}

export interface ProjectResources {
  provisioned: CloudResource[];
  /** Imported (pre-existing) cloud resources that will be KEPT, not deleted. */
  importedCount: number;
}

/**
 * Walk a project canvas and derive the cloud resources that a real delete would
 * destroy. Mirrors the backend deprovision logic in
 * workers/api/src/routes/workflowProvision.ts (DELETE /:projectId) so the
 * preview matches what actually gets removed. Imported nodes are never deleted.
 */
export function extractCloudResources(
  canvas: ReactFlowJsonObject | null | undefined,
): ProjectResources {
  const nodes = canvas?.nodes ?? [];
  const provisioned: CloudResource[] = [];
  let importedCount = 0;

  for (const node of nodes) {
    const data = ((node as { data?: unknown })?.data ?? {}) as Record<
      string,
      unknown
    >;
    const provider = data.provider as string | undefined;
    const label = (data.label as string | undefined) ?? provider ?? "resource";

    const hasCloudResource =
      (provider === "vercel" && !!data.vercelProjectId) ||
      (provider === "supabase" && !!data.supabaseProjectRef) ||
      (provider === "cloudflare" &&
        (!!data.cfWorkerNameProvisioned || !!data.cfBucketNameProvisioned));

    // Imported = pre-existing resource Leenar did not create; backend skips it.
    if (data.imported) {
      if (hasCloudResource) importedCount++;
      continue;
    }

    if (provider === "vercel" && data.vercelProjectId) {
      provisioned.push({ service: "vercel", label });
    } else if (provider === "supabase" && data.supabaseProjectRef) {
      provisioned.push({ service: "supabase", label });
    } else if (provider === "cloudflare") {
      if (data.cfWorkerNameProvisioned) {
        provisioned.push({ service: "cloudflare-workers", label });
      }
      if (data.cfBucketNameProvisioned) {
        provisioned.push({ service: "cloudflare-r2", label });
      }
    }
  }

  return { provisioned, importedCount };
}
