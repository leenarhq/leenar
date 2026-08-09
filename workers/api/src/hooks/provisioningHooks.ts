export type {
  ProvisioningHooks,
  QuotaCheck,
  QuotaReservation,
  IncidentProvider,
} from "./provisioningHooks.types";
import { noopProvisioningHooks } from "./noopProvisioningHooks";
import type { ProvisioningHooks } from "./provisioningHooks.types";

// Open-core: no quota (BYO key), no incident monitor, no rate limiting.
export const provisioningHooks: ProvisioningHooks = noopProvisioningHooks;
