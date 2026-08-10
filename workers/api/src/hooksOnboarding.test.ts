import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";
import { hooks } from "./routes/hooks";

const ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "svc-key",
  RESEND_API_KEY: "re_test",
  RESEND_FROM: "hi@leenar.net",
  FRONTEND_URL: "https://leenar.net",
} as any;

const USER_ID = "44444444-4444-4444-4444-444444444444";

type Call = { url: string; method: string };

function makeApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId" as never, USER_ID as never);
    await next();
  });
  app.route("/", hooks);
  return app;
}

function stubFetch(calls: Call[], resendOk: boolean) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/auth/v1/admin/users/")) {
      return new Response(JSON.stringify({ email: "u@x.com" }), { status: 200 });
    }
    // idempotency claim insert (POST) → fresh row inserted
    if (url.includes("/rest/v1/user_onboarding_sent") && method === "POST") {
      return new Response(JSON.stringify([{ user_id: USER_ID }]), { status: 201 });
    }
    // claim rollback DELETE
    if (url.includes("/rest/v1/user_onboarding_sent") && method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (url.includes("api.resend.com/emails")) {
      return resendOk
        ? new Response(JSON.stringify({ id: "email-1" }), { status: 200 })
        : new Response("resend down", { status: 500 });
    }
    return new Response("[]", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

const deleteCall = (calls: Call[]) =>
  calls.find((c) => c.url.includes("/rest/v1/user_onboarding_sent") && c.method === "DELETE");

describe("onboarding hook: release idempotency claim when email send fails", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("deletes the claim row when Resend fails (so a retry can resend)", async () => {
    const calls: Call[] = [];
    stubFetch(calls, false);

    const res = await makeApp().request(
      "/onboarding",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      ENV,
    );

    expect(res.status).toBe(200);
    expect(deleteCall(calls)).toBeTruthy();
  });

  it("does NOT delete the claim row when the email sends successfully", async () => {
    const calls: Call[] = [];
    stubFetch(calls, true);

    await makeApp().request(
      "/onboarding",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      ENV,
    );

    expect(deleteCall(calls)).toBeFalsy();
  });
});
