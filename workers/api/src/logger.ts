// Structured JSON logger for Cloudflare Workers.
// CF Logs ingests stdout as newline-delimited JSON — each console.log is a log line.

type Level = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg:  string, fields?: Record<string, unknown>): void
  warn(msg:  string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
  child(fields: Record<string, unknown>): Logger
}

// Substring markers — a key is redacted if its lowercased name contains any of
// these. Broader than exact-match so `userToken`, `x-api-key`, `refreshToken`
// etc. are all caught.
const REDACT_MARKERS = [
  'token', 'secret', 'password', 'passwd', 'apikey', 'api_key',
  'authorization', 'auth', 'credential', 'private_key', 'encryption',
] as const

function shouldRedact(key: string): boolean {
  const k = key.toLowerCase()
  // Exact 'key' catches bare secret fields without nuking innocuous *_key ids
  // (workflow_key, idempotency_key stay, but plain `key` is redacted).
  if (k === 'key') return true
  return REDACT_MARKERS.some((m) => k.includes(m))
}

// Recurse into nested objects/arrays so a secret buried under `.data.token`
// (not just a top-level key) is still masked. Bounded depth guards against
// pathological/cyclic structures.
function redactValue(value: unknown, depth: number): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1))
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      shouldRedact(k) ? [k, '[REDACTED]'] : [k, redactValue(v, depth + 1)]
    )
  )
}

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  return redactValue(obj, 0) as Record<string, unknown>
}

function emit(level: Level, msg: string, base: Record<string, unknown>, extra?: Record<string, unknown>) {
  const entry = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...redact(base),
    ...(extra ? redact(extra) : {}),
  }
  if (level === 'error') {
    console.error(JSON.stringify(entry))
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry))
  } else {
    console.log(JSON.stringify(entry))
  }
}

export function createLogger(base: Record<string, unknown> = {}): Logger {
  return {
    debug: (msg, fields) => emit('debug', msg, base, fields),
    info:  (msg, fields) => emit('info',  msg, base, fields),
    warn:  (msg, fields) => emit('warn',  msg, base, fields),
    error: (msg, fields) => emit('error', msg, base, fields),
    child: (fields) => createLogger({ ...base, ...fields }),
  }
}

export const log = createLogger()
