import { isCloud } from "./cloud";

/**
 * Which auth surfaces a given build can actually deliver.
 *
 * The self-hosted core build (`VITE_LEENAR_CLOUD=false`) ships the same auth
 * pages as cloud but sits on a very different backend, and several controls
 * are dead there for reasons that have nothing to do with each other:
 *
 * - `oauth` — the compose stack configures no external provider, so GoTrue
 *   answers `400 provider is not enabled`.
 * - `magicLink` / `passwordReset` — the bundled auth container runs with a
 *   noop mail client. `POST /auth/v1/recover` returns 200 and no mail is ever
 *   sent, so the user waits for an email that does not exist.
 * - `inviteRequired` — false everywhere now. Cloud ran invite-only while access
 *   was being rolled out: `/api/invite/*` plus the `check_invite_before_signup`
 *   trigger from migration 027. Migration 077 drops that trigger and signup is
 *   open, so the flag no longer varies by build. It stays as the one switch
 *   that puts the gate back (flip it and re-add the trigger — both halves are
 *   required; the frontend alone is not a gate).
 *
 * There is deliberately no `legalLinks` flag. Leenar's Terms and Privacy links
 * live only in the invite signup flow, which by definition renders only when
 * `inviteRequired` is true — a flag there could never be false. The self-host
 * signup form simply has no legal footer, and the core build already replaces
 * /terms and /privacy with "replace this with your own" placeholders.
 *
 * Kept as a pure function of an explicit boolean (rather than reading
 * `isCloud` directly) so it is testable — the web app has no component-test
 * infrastructure, so this is the only layer of the change a test can reach.
 */
export interface AuthSurface {
  /** Google / GitHub sign-in buttons on the login page. */
  oauth: boolean;
  /** "Sign in with magic link instead". */
  magicLink: boolean;
  /** "Forgot password?" on the login form. */
  passwordReset: boolean;
  /**
   * Signup demands a valid invite token. False on every build today — see the
   * note above before turning it back on.
   */
  inviteRequired: boolean;
}

export function authSurfaceFor(cloud: boolean): AuthSurface {
  return {
    oauth: cloud,
    magicLink: cloud,
    passwordReset: cloud,
    inviteRequired: false,
  };
}

export const authSurface = authSurfaceFor(isCloud);
