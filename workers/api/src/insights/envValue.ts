/**
 * Env var value normalization + fingerprinting, shared by the environment snapshot
 * collector and `diff_environments`.
 *
 * This lives in its own module rather than in `diffEnvironments.ts` because
 * `collectors.ts` fingerprints secrets before returning them — importing from
 * `diffEnvironments.ts` would make collectors <-> diffEnvironments a cycle.
 *
 * Fingerprints exist so two values can be compared without either ever being
 * returned to the caller. They are HMAC'd with ENCRYPTION_KEY rather than plainly
 * hashed: a bare SHA-256 of a low-entropy secret is brute-forceable, so an
 * accidental leak of a plain digest would be a leak of the secret. Keyed digests
 * are useless without the key.
 */

/**
 * Canonicalizes an env var value before fingerprinting.
 *
 * A `.env` file and a Leenar secret override routinely disagree cosmetically —
 * dotenv strips surrounding quotes and files end with a newline, neither of which
 * reaches the running process. Comparing raw would report `value_differs` for
 * values that are in fact identical at runtime, sending the user after a bug that
 * does not exist.
 *
 * Deliberately does NOT trim leading or interior whitespace: those survive into
 * the process and a value that differs only by a leading space really is different.
 */
export function normalizeEnvValue(raw: string): string {
  // One trailing newline only — a value that intentionally ends in blank lines
  // keeps the rest.
  let v = raw.replace(/\r?\n$/, "");

  // Surrounding *matching* quotes, as dotenv strips them.
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      v = v.slice(1, -1);
    }
  }

  return v;
}

const _keyCache = new Map<string, CryptoKey>();

async function getHmacKey(hexKey: string): Promise<CryptoKey> {
  const cached = _keyCache.get(hexKey);
  if (cached) return cached;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(hexKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  _keyCache.set(hexKey, key);
  return key;
}

/**
 * Keyed digest of a normalized env value. Equal digests mean equal runtime values.
 *
 * Never put the return value in a tool response — it is a comparison token, not
 * a disclosure-safe identifier.
 */
export async function fingerprint(
  raw: string,
  hexKey: string,
): Promise<string> {
  const key = await getHmacKey(hexKey);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(normalizeEnvValue(raw)),
  );
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++)
    hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
