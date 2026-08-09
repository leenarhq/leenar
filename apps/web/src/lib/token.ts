import { supabase } from "./supabase";

/**
 * True when a token should be proactively refreshed: already expired, missing
 * an expiry, or within `skewSec` of expiring. Pure — unit tested.
 */
export function shouldRefreshToken(
  expiresAtSec: number | undefined,
  nowMs: number,
  skewSec = 60,
): boolean {
  if (expiresAtSec === undefined) return true;
  return expiresAtSec - skewSec <= nowMs / 1000;
}

/**
 * Returns a valid access token, refreshing first if the current one is expired
 * or near expiry. Returns null when there is no session at all. This is the
 * single source of the bearer token for all API calls — no call site reads
 * `session.access_token` directly anymore.
 */
export async function getFreshToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;
  if (!shouldRefreshToken(session.expires_at, Date.now())) {
    return session.access_token;
  }
  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (error || !refreshed.session) {
    // Refresh failed — fall back to the current token (may be expired). The
    // server will 401; authorizedFetch handles the retry/redirect.
    return session.access_token;
  }
  return refreshed.session.access_token;
}
