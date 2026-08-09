import { withSentry } from "@sentry/cloudflare";
import { createApp, sentryOptions } from "./appSetup";
import { registerCoreRoutes } from "./routes/registerCoreRoutes";

export { ProvisionerDO } from "./provisioner.do";

// Open-core worker: core routes only, no cloud middleware (ipBlock/rateLimit),
// no cloud cron (scheduled). Cloud repo overlays those via its own index.ts.
const app = createApp([]);

registerCoreRoutes(app);

export default withSentry(sentryOptions, {
  fetch: app.fetch.bind(app),
});
