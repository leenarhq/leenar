import * as Sentry from "@sentry/react";
import type posthogLib from "posthog-js";

let ph: typeof posthogLib | null = null;

export async function initAnalytics() {
  if (localStorage.getItem("leenar_analytics_consent") !== "true") return;
  const phKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!phKey) return;
  const { default: posthog } = await import("posthog-js");
  if (!posthog.__loaded) {
    posthog.init(phKey, {
      api_host:
        (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ??
        "https://eu.i.posthog.com",
      capture_pageview: true,
      session_recording: { maskAllInputs: true },
    });
  }
  ph = posthog;
}

export function initMonitoring() {
  if (typeof window === "undefined") return;

  const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.MODE,
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: Number(
        import.meta.env.VITE_SENTRY_SAMPLE_RATE ?? "0.1",
      ),
    });
  }

  void initAnalytics();
}

// Send only user ID — don't send email/name (privacy)
export function identifyUser(userId: string) {
  Sentry.setUser({ id: userId });
  ph?.identify(userId);
}

export function clearUser() {
  Sentry.setUser(null);
  ph?.reset();
}

export function track(event: string, props?: Record<string, unknown>) {
  ph?.capture(event, props);
}
