import { useCallback, useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

/**
 * Cloudflare Turnstile for the auth forms.
 *
 * Signup is open, so `/signup` is a public endpoint that creates a row in
 * `auth.users` — the shape of thing that gets scripted. Verification happens in
 * GoTrue, not here: Supabase checks the token against the secret configured in
 * Auth → Bot and Abuse Protection, which is the only check a browser can't
 * skip by not calling this component.
 *
 * That setting covers sign-up, password sign-in, magic link and password reset
 * together, so all four have to send a token or they start failing — hence one
 * hook, used by both pages.
 *
 * Keyed off `VITE_TURNSTILE_SITE_KEY` (a site key is public by design): unset,
 * this is inert and the forms behave exactly as they did before. Set it and
 * enable Turnstile in Supabase, in that order, and the widget appears.
 */
const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string) ?? "";

export type Captcha = {
  /** The widget, or null when no site key is configured. */
  widget: React.ReactNode;
  /**
   * Spread into a Supabase auth call's `options`. Empty when Turnstile is off,
   * so the call is byte-for-byte what it was before.
   */
  options: { captchaToken?: string };
  /** False while the challenge is still outstanding — gate the submit on it. */
  ready: boolean;
  /**
   * Call after a failed attempt. Turnstile tokens are single-use, so without
   * this a second try sends a spent token and fails for the wrong reason.
   */
  reset: () => void;
};

export function useCaptcha(): Captcha {
  const ref = useRef<TurnstileInstance>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const enabled = Boolean(SITE_KEY);

  const reset = useCallback(() => {
    setToken(null);
    setFailed(false);
    ref.current?.reset();
  }, []);

  return {
    widget: enabled ? (
      <div className="flex flex-col items-center gap-2">
        <Turnstile
          ref={ref}
          siteKey={SITE_KEY}
          onSuccess={(next) => {
            setFailed(false);
            setToken(next);
          }}
          onExpire={() => setToken(null)}
          onError={() => {
            setToken(null);
            setFailed(true);
          }}
          options={{ theme: "dark", size: "flexible" }}
        />
        {/*
          Without this the submit button is simply dead: it is gated on a token,
          and a widget that fails to render (blocked network, a site key that
          doesn't cover this hostname) never produces one and never says so.
        */}
        {failed && (
          <p className="text-xs text-destructive">
            Verification didn&apos;t load. Reload the page and try again.
          </p>
        )}
      </div>
    ) : null,
    options: enabled && token ? { captchaToken: token } : {},
    ready: !enabled || Boolean(token),
    reset,
  };
}
