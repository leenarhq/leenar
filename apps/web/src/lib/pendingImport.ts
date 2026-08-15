/**
 * Which builder someone was exporting from before they had an account — set
 * by an SEO guide's CTA (e.g. "lovable") so the import door on the console
 * can jump straight to fetching their repo instead of starting from a blank
 * chat.
 *
 * localStorage rather than a query string or sessionStorage, for the same
 * reason as lib/pendingPrompt: the trip from the guide to the console can go
 * through sign-up, a confirmation email and an OAuth round-trip — and a
 * confirmation link routinely opens in a different tab from the one that
 * clicked the CTA, which is exactly what sessionStorage does not survive.
 * Keeping it out of the URL also keeps it out of logs, referrers and shared
 * links.
 *
 * Read once and cleared, so a reload of the console doesn't re-trigger it,
 * and expired after an hour so a click abandoned days ago never surprises
 * anyone by firing later.
 */
const KEY = "leenar_pending_import";

/** Long enough to read a confirmation email, short enough to stay intentional. */
const TTL_MS = 60 * 60 * 1000;

type Stored = { builder: string; ts: number };

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed?.builder !== "string" || typeof parsed?.ts !== "number") {
      localStorage.removeItem(KEY);
      return null;
    }
    if (Date.now() - parsed.ts > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return { builder: parsed.builder, ts: parsed.ts };
  } catch {
    // Private mode, a full quota, or something else wrote the key. The
    // hand-off is a convenience — the user still lands in the console, just
    // without the repo field pre-focused.
    return null;
  }
}

export function setPendingImport(builder: string): void {
  const trimmed = builder.trim();
  if (!trimmed) return;
  try {
    const stored: Stored = { builder: trimmed, ts: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // See read().
  }
}

/** Returns the stored builder name and removes it. Null when there is none. */
export function takePendingImport(): string | null {
  const stored = read();
  try {
    localStorage.removeItem(KEY);
  } catch {
    // See read().
  }
  return stored?.builder ?? null;
}
