import { describe, it, expect } from "vitest";
import { extractCloudResources } from "./projectResources";

// Minimal canvas builder — only `nodes` matters to the function.
const canvas = (nodes: unknown[]) =>
  ({ nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }) as never;

describe("extractCloudResources", () => {
  it("collects provisioned cloud resources across providers", () => {
    const result = extractCloudResources(
      canvas([
        {
          data: { provider: "vercel", vercelProjectId: "prj_1", label: "web" },
        },
        {
          data: {
            provider: "supabase",
            supabaseProjectRef: "ref_1",
            label: "db",
          },
        },
        {
          data: {
            provider: "cloudflare",
            cfWorkerNameProvisioned: "api",
            label: "api",
          },
        },
      ]),
    );
    expect(result.provisioned).toEqual([
      { service: "vercel", label: "web" },
      { service: "supabase", label: "db" },
      { service: "cloudflare-workers", label: "api" },
    ]);
    expect(result.importedCount).toBe(0);
  });

  it("counts imported resources separately and never lists them", () => {
    const result = extractCloudResources(
      canvas([
        {
          data: { provider: "vercel", vercelProjectId: "prj_1", label: "web" },
        },
        {
          data: {
            provider: "supabase",
            supabaseProjectRef: "ref_x",
            imported: true,
            label: "existing-db",
          },
        },
      ]),
    );
    expect(result.provisioned).toEqual([{ service: "vercel", label: "web" }]);
    expect(result.importedCount).toBe(1);
  });

  it("emits worker and bucket as separate entries for one cloudflare node", () => {
    const result = extractCloudResources(
      canvas([
        {
          data: {
            provider: "cloudflare",
            cfWorkerNameProvisioned: "api",
            cfBucketNameProvisioned: "assets",
            label: "cf",
          },
        },
      ]),
    );
    expect(result.provisioned).toEqual([
      { service: "cloudflare-workers", label: "cf" },
      { service: "cloudflare-r2", label: "cf" },
    ]);
  });

  it("ignores config-only and unprovisioned nodes", () => {
    const result = extractCloudResources(
      canvas([
        { data: { provider: "github", label: "repo" } },
        { data: { provider: "resend", label: "email" } },
        { data: { provider: "vercel", label: "not-yet-deployed" } }, // no vercelProjectId
      ]),
    );
    expect(result.provisioned).toEqual([]);
    expect(result.importedCount).toBe(0);
  });

  it("handles empty or missing canvas", () => {
    expect(extractCloudResources(null)).toEqual({
      provisioned: [],
      importedCount: 0,
    });
    expect(extractCloudResources(canvas([]))).toEqual({
      provisioned: [],
      importedCount: 0,
    });
  });
});
