import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { initAnalytics } from "../lib/monitoring";

const CONSENT_KEY = "leenar_analytics_consent";

/**
 * Cookie/analytics consent banner. Analytics (PostHog) stay disabled until the
 * visitor explicitly accepts — see initAnalytics() in lib/monitoring.ts, which
 * bails unless this key is exactly "true".
 */
export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show only when the visitor hasn't decided yet (neither "true" nor "false").
    if (localStorage.getItem(CONSENT_KEY) === null) setVisible(true);
  }, []);

  function accept() {
    localStorage.setItem(CONSENT_KEY, "true");
    setVisible(false);
    void initAnalytics();
  }

  function decline() {
    localStorage.setItem(CONSENT_KEY, "false");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          We use cookies and analytics to understand how Leenar is used and
          improve it. See our{" "}
          <Link to="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={decline}
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={accept}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
