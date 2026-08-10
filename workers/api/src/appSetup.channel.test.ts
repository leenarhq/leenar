/**
 * E4 — integration coverage for the audit `channel` wiring in the auth
 * middleware. Proves the real createApp() middleware attaches a per-request
 * `_auditChannel` to c.env (mcp for lnr_ API keys, web for JWTs) and that the
 * reassignment is visible to a downstream handler — the assumption auditLog
 * relies on. verifyApiKey / verifyJWT are mocked so no real crypto is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./routes/apiKeys", () => ({
  verifyApiKey: vi.fn(),
}));
vi.mock("./auth", async (orig) => ({
  ...(await orig<typeof import("./auth")>()),
  verifyJWT: vi.fn(),
}));

import { createApp } from "./appSetup";
import { verifyApiKey } from "./routes/apiKeys";
import { verifyJWT } from "./auth";

const ENV = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  SUPABASE_JWT_SECRET: "jwt-secret",
} as any;

function appWithProbe() {
  const app = createApp();
  // Downstream handler reports what the middleware left on c.env.
  app.get("/api/_probe", (c) => c.text((c.env as any)._auditChannel ?? "none"));
  return app;
}

describe("audit channel wiring (auth middleware → c.env)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tags an lnr_ API key request as channel 'mcp'", async () => {
    (verifyApiKey as any).mockResolvedValue({ userId: "u1", scope: "read" });
    const res = await appWithProbe().request(
      "/api/_probe",
      { headers: { Authorization: "Bearer lnr_testkey" } },
      ENV,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("mcp");
  });

  it("tags a JWT request as channel 'web'", async () => {
    (verifyJWT as any).mockResolvedValue({ ok: true, payload: { sub: "u1", email: "e@x.co" } });
    const res = await appWithProbe().request(
      "/api/_probe",
      { headers: { Authorization: "Bearer some.jwt.token" } },
      ENV,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("web");
  });
});
