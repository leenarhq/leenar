import { describe, it, expect } from "vitest";
import { noopProvisioningHooks } from "./noopProvisioningHooks";

const env = {} as any;

describe("noopProvisioningHooks", () => {
  it("reserve always allows with null reservationId", async () => {
    const r = await noopProvisioningHooks.quota.reserve("u1", env);
    expect(r.allowed).toBe(true);
    expect(r.reservationId).toBeNull();
  });

  it("release / recordTokens resolve without throwing", async () => {
    await expect(noopProvisioningHooks.quota.release("u1", env)).resolves.toBeUndefined();
    await expect(
      noopProvisioningHooks.quota.recordTokens("u1", "claude", 10, 20, env, null),
    ).resolves.toBeUndefined();
  });

  it("monitor start/stop resolve without throwing", async () => {
    await expect(noopProvisioningHooks.monitor.start(env, "p1", "u1", "vercel", "r1")).resolves.toBeUndefined();
    await expect(noopProvisioningHooks.monitor.stop(env, "p1")).resolves.toBeUndefined();
  });

  it("rateLimit.check always returns true (never limits)", async () => {
    await expect(noopProvisioningHooks.rateLimit.check(env, "u1", "chat", 5, 1000)).resolves.toBe(true);
  });

  it("exposes a numeric dailyUserMsgLimit", () => {
    expect(typeof noopProvisioningHooks.quota.dailyUserMsgLimit).toBe("number");
  });
});
