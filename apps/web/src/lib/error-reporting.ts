import * as Sentry from "@sentry/react";

type PlatformErrorOptions = {
  mechanism?:
    | "manual"
    | "onerror"
    | "unhandledrejection"
    | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type PlatformErrorEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: PlatformErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: PlatformErrorEvents;
  }
}

export function reportError(
  error: unknown,
  context: Record<string, unknown> = {},
) {
  if (typeof window === "undefined") return;
  const fullContext = {
    source: "react_error_boundary",
    route: window.location.pathname,
    ...context,
  };
  Sentry.captureException(error, { extra: fullContext });
  window.__lovableEvents?.captureException?.(error, fullContext, {
    mechanism: "react_error_boundary",
    handled: false,
    severity: "error",
  });
}
