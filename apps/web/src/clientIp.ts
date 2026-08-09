// Client IP from Cloudflare's trusted header ONLY. X-Forwarded-For is
// attacker-controllable when the Worker is reached directly, so it is never used
// (matches the API worker's write-time IP-trust policy).
export function clientIp(headers: Headers): string {
  return headers.get("CF-Connecting-IP") ?? "unknown";
}
