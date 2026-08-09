// Attack weight per security_events.reason. The securityCheck cron sums these
// per IP so a burst of forged-signature probes scores far higher than the same
// number of already-throttled rate-limit hits. Reasons come from
// classifyAuthFailure (auth_<reason>) and the rate-limit middleware (rate_limit).
const WEIGHTS: Record<string, number> = {
  auth_invalid_signature: 5,
  auth_bad_claims:        5,
  auth_bad_alg:           5,
  auth_bad_key:           5,
  auth_malformed:         2,
  rate_limit:             1,
}

export function securityWeight(reason: string): number {
  return WEIGHTS[reason] ?? 1
}

export function scoreEvents(
  events: { ip: string; reason: string; weight?: number | null }[],
): Map<string, number> {
  const scores = new Map<string, number>()
  for (const e of events) {
    const w = e.weight ?? securityWeight(e.reason)
    scores.set(e.ip, (scores.get(e.ip) ?? 0) + w)
  }
  return scores
}

export interface BlockTiers {
  appBlocks: { ip: string; score: number }[]
  cfBlocks: { ip: string; score: number }[]
}

// Split scored IPs into two enforcement tiers, honoring the authenticated
// allowlist (never blocked in either tier).
//   score < appThreshold                      -> neither (429s already applied)
//   appThreshold <= score < cfThreshold       -> app-level KV block (light, no CF rule)
//   score >= cfThreshold, OR ip in repeatIps  -> Cloudflare rule (heavy)
// repeatIps carries IPs already app-blocked in the recent lookback, so a returning
// attacker escalates straight to an edge rule.
export function classifyBlocks(
  scores: Map<string, number>,
  allowlist: Set<string>,
  appThreshold: number,
  cfThreshold: number,
  repeatIps: Set<string>,
): BlockTiers {
  const appBlocks: { ip: string; score: number }[] = []
  const cfBlocks: { ip: string; score: number }[] = []
  for (const [ip, score] of scores) {
    if (allowlist.has(ip)) continue
    if (score < appThreshold) continue
    if (score >= cfThreshold || repeatIps.has(ip)) {
      cfBlocks.push({ ip, score })
    } else {
      appBlocks.push({ ip, score })
    }
  }
  appBlocks.sort((a, b) => b.score - a.score)
  cfBlocks.sort((a, b) => b.score - a.score)
  return { appBlocks, cfBlocks }
}
