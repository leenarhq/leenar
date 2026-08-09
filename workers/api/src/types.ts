import type { WorkingCanvas } from "./canvasDiff";

export interface Env {
  // Durable Objects
  PROVISIONER:      DurableObjectNamespace
  RATE_LIMITER:     DurableObjectNamespace
  INCIDENT_MONITOR: DurableObjectNamespace

  // Cloudflare KV — hot-path IP block store (see ipBlockStore.ts)
  IP_BLOCKS: KVNamespace

  // Supabase
  SUPABASE_URL: string
  SUPABASE_JWT_SECRET: string
  SUPABASE_SERVICE_ROLE_KEY: string
  SUPABASE_CLIENT_ID: string
  SUPABASE_CLIENT_SECRET: string

  // OAuth providers
  VERCEL_CLIENT_ID: string
  VERCEL_CLIENT_SECRET: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string

  // GitHub App
  GITHUB_APP_ID: string
  GITHUB_APP_PRIVATE_KEY: string

  // AI
  OPENAI_API_KEY: string

  // Encryption & auth
  ENCRYPTION_KEY: string       // 32-byte hex (64 chars), AES-256-GCM
  INTERNAL_SECRET: string      // Worker → DO auth secret
  STATE_SIGNING_SECRET: string // OAuth state HMAC — separate from ENCRYPTION_KEY
  ADMIN_SECRET: string         // x-admin-key header for admin-only endpoints

  // Email
  RESEND_API_KEY: string    // Resend key for outbound system emails
  RESEND_FROM: string       // e.g. "Acme <hello@example.com>"

  // Config
  FRONTEND_URL: string      // e.g. https://app.example.com
  API_URL: string           // e.g. https://api.example.com
  ADMIN_EMAIL: string       // e.g. admin@example.com

  // CORS — comma-separated allowlist of browser origins. Falls back to
  // FRONTEND_URL when unset, so a single-origin install needs no extra config.
  CORS_ALLOWED_ORIGINS?: string // e.g. "https://app.example.com,https://www.app.example.com"

  // Deployment attribution — name/url/email stamped into users' deployed repos
  // (the marker commit + GitHub Deployment record). Fall back to generic,
  // FRONTEND_URL-derived values so self-host installs carry no vendor branding.
  DEPLOY_BRAND_NAME?: string  // e.g. "Acme"; default "Deployment"
  DEPLOY_BRAND_URL?: string   // e.g. https://app.example.com; default FRONTEND_URL
  DEPLOY_COMMIT_EMAIL?: string // e.g. deploy@example.com; default deploy@<frontend-host>

  // Observability
  SENTRY_DSN: string
  SENTRY_ENVIRONMENT: string

  // Cloudflare (for auto-IP blocking from security cron)
  CF_API_TOKEN: string
  CF_ZONE_ID: string

  // Turnstile (CAPTCHA for public endpoints)
  TURNSTILE_SECRET_KEY: string

  // Security alert recipient
  SECURITY_ALERT_EMAIL: string

  // Slack channel (AI DevOps engineer over Slack) — set via `wrangler secret put`
  SLACK_SIGNING_SECRET?: string // verifies inbound Slack request signatures
  SLACK_BOT_TOKEN?: string      // xoxb- token for chat.postMessage

  // WhatsApp channel (Meta Cloud API) — set via `wrangler secret put`
  WHATSAPP_VERIFY_TOKEN?: string    // echoed during webhook subscription handshake
  WHATSAPP_APP_SECRET?: string      // verifies x-hub-signature-256 on inbound messages
  WHATSAPP_ACCESS_TOKEN?: string    // Graph API token for sending replies
  WHATSAPP_PHONE_NUMBER_ID?: string // sender phone number id for the Graph API

  // Per-call audit source override, attached by callTool for agent/channel
  // dispatch (not a binding). auditLog reads it to attribute the action.
  _auditSource?: string

  // Per-request transport-derived channel (web|mcp), attached by the auth
  // middleware from authMethod (not a binding). auditLog writes it to the
  // channel column; a more specific _auditSource (slack/agent/cron) wins.
  _auditChannel?: string

  // Per-turn in-memory canvas for the web canvas-editing agent (mode:"canvas").
  // When present, canvas-editing MCP tools mutate THIS object instead of the DB;
  // runAgent diffs it at turn end and the client persists via its own autosave.
  _workingCanvas?: WorkingCanvas
}

export interface JWTPayload {
  sub: string     // user_id
  email?: string
  exp: number
  nbf?: number
  aud: string
  iss?: string
}
