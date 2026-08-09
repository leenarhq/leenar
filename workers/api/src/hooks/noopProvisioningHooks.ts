import type { ProvisioningHooks } from "./provisioningHooks.types";

// Open-core default: no quota (BYO OpenAI key = unlimited), no always-on
// incident monitor, no rate limiting (single trusted self-host user).
export const noopProvisioningHooks: ProvisioningHooks = {
  quota: {
    dailyUserMsgLimit: Number.MAX_SAFE_INTEGER,
    async reserve() {
      return { allowed: true, reservationId: null };
    },
    async release() {},
    async recordTokens() {},
  },
  monitor: {
    async start() {},
    async stop() {},
  },
  rateLimit: {
    async check() {
      return true;
    },
  },
  autopilot: {
    async reconcile() {},
  },
};
