import { describe, it, expect } from "vitest";
import { computeDesiredEnvKeys } from "./envFlowUtils";

// cloudflare-r2 → vercel keys (from constants/envFlow.ts)
// R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are write-once secrets excluded from
// drift-facing output — see WRITE_ONCE_ENV_KEYS in constants/envFlow.ts.
const R2_KEYS = ["R2_BUCKET_NAME", "R2_ENDPOINT"];

function r2Node(status: string) {
  return {
    id: "r2",
    data: { provider: "cloudflare", cloudflareService: "r2", status },
  };
}
function vercelNode(status = "provisioned") {
  return { id: "vercel", data: { provider: "vercel", status } };
}
function supabaseNode(status: string) {
  return { id: "sb", data: { provider: "supabase", status } };
}

describe("computeDesiredEnvKeys — requireProvisionedSource", () => {
  it("without the option, includes keys from an un-provisioned source (legacy behavior)", () => {
    const keys = computeDesiredEnvKeys(
      {
        nodes: [r2Node("draft"), vercelNode()],
        edges: [{ source: "r2", target: "vercel" }],
      },
      "vercel",
    );
    expect(keys.sort()).toEqual([...R2_KEYS].sort());
  });

  it("with requireProvisionedSource, EXCLUDES keys whose source node is not provisioned", () => {
    const keys = computeDesiredEnvKeys(
      {
        nodes: [r2Node("draft"), vercelNode()],
        edges: [{ source: "r2", target: "vercel" }],
      },
      "vercel",
      { requireProvisionedSource: true },
    );
    expect(keys).toEqual([]);
  });

  it("with requireProvisionedSource, INCLUDES keys whose source node IS provisioned", () => {
    const keys = computeDesiredEnvKeys(
      {
        nodes: [r2Node("provisioned"), vercelNode()],
        edges: [{ source: "r2", target: "vercel" }],
      },
      "vercel",
      { requireProvisionedSource: true },
    );
    expect(keys.sort()).toEqual([...R2_KEYS].sort());
  });

  it("with requireProvisionedSource, keeps provisioned-source keys while dropping un-provisioned ones (mixed)", () => {
    const keys = computeDesiredEnvKeys(
      {
        nodes: [r2Node("draft"), supabaseNode("provisioned"), vercelNode()],
        edges: [
          { source: "r2", target: "vercel" },
          { source: "sb", target: "vercel" },
        ],
      },
      "vercel",
      { requireProvisionedSource: true },
    );
    // R2 dropped (draft), Supabase kept (provisioned)
    expect(keys).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(keys).not.toContain("R2_BUCKET_NAME");
  });

  it("includes customEnvVars set directly on the target node (no source / no edge required)", () => {
    const node = {
      id: "vercel",
      data: {
        provider: "vercel",
        status: "provisioned",
        customEnvVars: [
          { key: "MY_API_KEY", value: "secret" },
          { key: "ANOTHER_VAR", value: "val" },
        ],
      },
    };
    const keys = computeDesiredEnvKeys({ nodes: [node], edges: [] }, "vercel");
    expect(keys).toContain("MY_API_KEY");
    expect(keys).toContain("ANOTHER_VAR");
  });

  it("customEnvVars keys are included even with requireProvisionedSource", () => {
    const node = {
      id: "vercel",
      data: {
        provider: "vercel",
        status: "provisioned",
        customEnvVars: [{ key: "MY_API_KEY", value: "secret" }],
      },
    };
    const keys = computeDesiredEnvKeys({ nodes: [node], edges: [] }, "vercel", {
      requireProvisionedSource: true,
    });
    expect(keys).toContain("MY_API_KEY");
  });

  it("includes orphan-edge envVars even when source node is missing from canvas", () => {
    // Source node removed after provisioning — only the edge remains.
    // Explicit envVars on the edge should still be tracked for drift detection.
    const keys = computeDesiredEnvKeys(
      {
        nodes: [vercelNode()],
        edges: [{ source: "r2-gone", target: "vercel", data: { envVars: ["R2_BUCKET_NAME", "R2_ENDPOINT"] } }],
      },
      "vercel",
    );
    expect(keys).toContain("R2_BUCKET_NAME");
    expect(keys).toContain("R2_ENDPOINT");
  });

  it("includes orphan-edge envVars even with requireProvisionedSource (source unknown = trust the edge)", () => {
    const keys = computeDesiredEnvKeys(
      {
        nodes: [vercelNode()],
        edges: [{ source: "r2-gone", target: "vercel", data: { envVars: ["R2_BUCKET_NAME"] } }],
      },
      "vercel",
      { requireProvisionedSource: true },
    );
    expect(keys).toContain("R2_BUCKET_NAME");
  });

  it("with requireProvisionedSource, gates user-override edge.data.envVars on the source too", () => {
    const keys = computeDesiredEnvKeys(
      {
        nodes: [r2Node("draft"), vercelNode()],
        edges: [
          { source: "r2", target: "vercel", data: { envVars: ["CUSTOM_KEY"] } },
        ],
      },
      "vercel",
      { requireProvisionedSource: true },
    );
    expect(keys).toEqual([]);
  });

  it("shotguns supabase public keys into a vercel node with no framework", () => {
    const canvas = {
      nodes: [
        { id: "sb", data: { provider: "supabase" } },
        { id: "vc", data: { provider: "vercel" } },
      ],
      edges: [{ source: "sb", target: "vc" }],
    };
    const keys = computeDesiredEnvKeys(canvas, "vc");
    expect(keys).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(keys).toContain("VITE_SUPABASE_URL");
    expect(keys).toContain("PUBLIC_SUPABASE_URL");
    expect(keys).toContain("SUPABASE_SERVICE_ROLE_KEY"); // server var, raw
  });

  it("narrows to the vercel node framework when set", () => {
    const canvas = {
      nodes: [
        { id: "sb", data: { provider: "supabase" } },
        { id: "vc", data: { provider: "vercel", framework: "vite" } },
      ],
      edges: [{ source: "sb", target: "vc" }],
    };
    const keys = computeDesiredEnvKeys(canvas, "vc");
    expect(keys).toContain("VITE_SUPABASE_URL");
    expect(keys).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(keys).not.toContain("PUBLIC_SUPABASE_URL");
  });
});

describe("computeDesiredEnvKeys — backwards-override edge (source-side)", () => {
  // A backwards-drawn override edge V→S (no ENV_FLOW[vercel][supabase], but
  // ENV_FLOW[supabase][vercel] exists) is flipped by normalizeEnvInjection and
  // injected INTO the source (V). computeDesiredEnvKeys must count those keys on
  // V too, otherwise env_stale drift deletes a live env var. See fix 1.
  it("includes a backwards-flipped override edge's vars on the source node", () => {
    const canvas = {
      nodes: [
        { id: "V", data: { provider: "vercel", status: "provisioned" } },
        { id: "S", data: { provider: "supabase", status: "provisioned" } },
      ],
      edges: [{ source: "V", target: "S", data: { envVars: ["CUSTOM_KEY"] } }],
    };
    expect(computeDesiredEnvKeys(canvas, "V")).toContain("CUSTOM_KEY");
  });

  it("does NOT route a forward override (V→W, ENV_FLOW pair exists) onto the source", () => {
    // vercel→cloudflare-workers IS a real ENV_FLOW pair, so the override lands on
    // the target W, not the source V — no flip. Regression guard.
    const canvas = {
      nodes: [
        { id: "V", data: { provider: "vercel", status: "provisioned" } },
        {
          id: "W",
          data: { provider: "cloudflare", status: "provisioned" },
        },
      ],
      edges: [{ source: "V", target: "W", data: { envVars: ["CUSTOM_KEY"] } }],
    };
    expect(computeDesiredEnvKeys(canvas, "V")).not.toContain("CUSTOM_KEY");
    // ...and it DOES land on the target W.
    expect(computeDesiredEnvKeys(canvas, "W")).toContain("CUSTOM_KEY");
  });

  it("gates the flipped override on the value-provider (target) being provisioned", () => {
    const canvas = {
      nodes: [
        { id: "V", data: { provider: "vercel", status: "provisioned" } },
        { id: "S", data: { provider: "supabase", status: "draft" } },
      ],
      edges: [{ source: "V", target: "S", data: { envVars: ["CUSTOM_KEY"] } }],
    };
    // With requireProvisionedSource, an un-provisioned target (value provider)
    // means the var was never injected — must not count toward desired keys.
    expect(
      computeDesiredEnvKeys(canvas, "V", { requireProvisionedSource: true }),
    ).not.toContain("CUSTOM_KEY");
  });
});
