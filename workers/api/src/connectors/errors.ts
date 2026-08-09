/**
 * Thrown when a provider API returns HTTP 429 Too Many Requests.
 * The `waitMs` field holds how long the caller should wait before retrying,
 * derived from the `Retry-After` response header (or 60 s as a fallback).
 */
export class RateLimitError extends Error {
  readonly waitMs: number

  constructor(message: string, waitMs: number) {
    super(message)
    this.name = 'RateLimitError'
    this.waitMs = waitMs
  }
}

/**
 * Parse a Retry-After header value (seconds or HTTP-date) into milliseconds.
 * Falls back to `defaultMs` when the header is absent or unparseable.
 */
export function parseRetryAfterMs(header: string | null, defaultMs = 60_000): number {
  if (!header) return defaultMs
  const seconds = parseInt(header, 10)
  if (!isNaN(seconds) && seconds >= 0) return seconds * 1000
  // HTTP-date format (e.g. "Wed, 21 Oct 2015 07:28:00 GMT")
  const date = Date.parse(header)
  if (!isNaN(date)) return Math.max(0, date - Date.now())
  return defaultMs
}

/**
 * Throw a `RateLimitError` if `res.status === 429`, otherwise return `res` unchanged.
 * Consumes the body only when it is a 429 so callers can still read the body on success.
 */
export function assertNotRateLimited(res: Response): Response {
  if (res.status === 429) {
    const waitMs = parseRetryAfterMs(res.headers.get('Retry-After'))
    throw new RateLimitError(`Rate limited. Retry after ${waitMs}ms`, waitMs)
  }
  return res
}
