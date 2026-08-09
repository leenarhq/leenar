// Password-recovery session flag.
//
// Supabase's implicit flow turns a password-reset link into a *real* session,
// indistinguishable from a normal login. The app's public routes blanket-redirect
// any session to /dashboard, which would drop a recovering user straight into the
// app instead of the "set new password" form. This flag lets every guard tell a
// recovery session apart from a real login.
//
// Stored in sessionStorage so it survives the full page load the email link
// triggers, and clears itself when the tab closes.
const KEY = "leenar:recovery";

export function markRecovery() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* storage unavailable — fall back to in-memory context state */
  }
}

export function isRecovering(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function clearRecovery() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
