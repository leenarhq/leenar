// Throttles the authenticated-IP allowlist marker. The auth middleware records a
// security_events row (blocked:false, reason:'auth_success', weight:0) when a JWT
// verifies, so securityCheck can allowlist IPs with a live session. To avoid a DB
// write on every request, each isolate keeps an in-memory last-seen map and marks
// an IP at most once per throttle window.
export const AUTH_SUCCESS_THROTTLE_MS = 5 * 60 * 1000

export function shouldMarkAuthSuccess(
  ip: string,
  nowMs: number,
  seen: Map<string, number>,
  throttleMs: number,
): boolean {
  if (!ip || ip === 'unknown') return false
  const last = seen.get(ip)
  if (last !== undefined && nowMs - last < throttleMs) return false
  seen.set(ip, nowMs)
  return true
}
