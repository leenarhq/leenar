/**
 * The prompt someone typed into the landing hero before they had an account.
 *
 * localStorage rather than a query string or sessionStorage. The trip from the
 * hero to the console can go through sign-up, a confirmation email and an OAuth
 * round-trip — and a confirmation link routinely opens in a different tab from
 * the one that typed the prompt, which is exactly what sessionStorage does not
 * survive. Keeping it out of the URL also keeps a possibly long prompt out of
 * logs, referrers and shared links.
 *
 * Read once and cleared, so a reload of the console doesn't re-send it, and
 * expired after an hour so a prompt abandoned days ago never surprises anyone
 * by sending itself.
 */
const KEY = "leenar_pending_prompt";

/** Longer than any prompt worth keeping, short enough not to abuse the quota. */
const MAX_LENGTH = 2000;

/** Long enough to read a confirmation email, short enough to stay intentional. */
const TTL_MS = 60 * 60 * 1000;

type Stored = { prompt: string; ts: number };

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed?.prompt !== "string" || typeof parsed?.ts !== "number") {
      localStorage.removeItem(KEY);
      return null;
    }
    if (Date.now() - parsed.ts > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return { prompt: parsed.prompt, ts: parsed.ts };
  } catch {
    // Private mode, a full quota, or something else wrote the key. The hand-off
    // is a convenience — the user still lands in the chat, just with an empty box.
    return null;
  }
}

export function setPendingPrompt(prompt: string): void {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  try {
    const stored: Stored = {
      prompt: trimmed.slice(0, MAX_LENGTH),
      ts: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // See read().
  }
}

export function hasPendingPrompt(): boolean {
  return read() !== null;
}

/** Returns the stored prompt and removes it. Null when there is none. */
export function takePendingPrompt(): string | null {
  const stored = read();
  try {
    localStorage.removeItem(KEY);
  } catch {
    // See read().
  }
  return stored?.prompt ?? null;
}
