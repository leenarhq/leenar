import type { Session } from "@supabase/supabase-js";

/**
 * True when two auth sessions are equivalent for app purposes.
 *
 * Supabase's `onAuthStateChange` re-emits the session object frequently (focus,
 * visibility, internal ticks) with a brand-new object reference but the SAME
 * access token. If we naively push every emit into React state, the auth
 * context value changes reference each time, re-running every `[session]`
 * effect across the app (dashboard refetch, onboarding refetch, canvas remount)
 * — making the UI look like it reloads every few seconds.
 *
 * We treat a session as "changed" only when the access token or the user id
 * actually differs (or when logging in/out), which is what every consumer
 * truly depends on.
 */
export function sameSession(a: Session | null, b: Session | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.access_token === b.access_token && a.user?.id === b.user?.id;
}
