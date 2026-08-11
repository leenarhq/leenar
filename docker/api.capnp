using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .mainWorker),
    # The PROVISIONER DO's storage is written to this disk (kept by a volume).
    (name = "do-disk", disk = (path = "do-state", writable = true)),
    # workerd's default globalOutbound ("internet") allows public IPs only, as
    # an SSRF guard. The `kong` service in Docker Compose lives on a private
    # bridge-network IP, so under that default the worker's fetch() is refused
    # with `connect() blocked by restrictPeers()` (reproduced in the smoke
    # test). "public" is what the real internet calls need — api.openai.com,
    # reached with OPENAI_API_KEY. Both permissions are required.
    #
    # tlsOptions is REQUIRED, and so is each of its two parts:
    #   - With no tlsOptions at all, workerd builds this network service
    #     without TLS and EVERY https:// fetch fails with `expected tlsNetwork
    #     != nullptr; this HttpClient doesn't support HTTPS`. Unlike workerd's
    #     built-in "internet" service, custom network services do not get TLS
    #     on their own.
    #   - `tlsOptions = ()` alone is not enough either: TLS comes up but the
    #     trust store is empty → `certificate is not trusted; unable to get
    #     local issuer certificate`. trustBrowserCas = true tells it to use the
    #     system CA set — which is why Dockerfile.api's runtime stage installs
    #     ca-certificates (node:24-bookworm-slim ships an EMPTY /etc/ssl/certs).
    #     Neither half works without the other.
    # What this affects: chat→canvas via OPENAI_API_KEY and the
    # GitHub/Vercel/Supabase connectors — the entire outbound provisioning path.
    (name = "outbound", network = (allow = ["public", "private"], tlsOptions = (trustBrowserCas = true))),
  ],
  sockets = [
    (name = "http", address = "*:8787", http = (), service = "main"),
  ],
);

const mainWorker :Workerd.Worker = (
  # Keep in sync with the API worker's wrangler.toml compatibility_date
  # (workers/api/wrangler.toml) — this capnp, not wrangler.toml, is what
  # actually drives runtime compat under workerd here. Enforced upstream by
  # scripts/open-core/test/capnp-compat-date.test.mjs.
  compatibilityDate = "2024-09-23",
  compatibilityFlags = ["nodejs_compat"],
  modules = [
    # NOTE: bundle name verified against actual `wrangler deploy --dry-run
    # --outdir=dist` output — wrangler 4.x emits `index.js` (not `worker.js`),
    # no additional chunks/.wasm. Keep this in sync with Dockerfile.api's
    # build stage if the wrangler version or entry point ever changes.
    (name = "index.js", esModule = embed "dist/index.js"),
  ],
  durableObjectNamespaces = [
    (className = "ProvisionerDO", uniqueKey = "leenar-provisioner-selfhost"),
  ],
  durableObjectStorage = (localDisk = "do-disk"),
  globalOutbound = "outbound",
  bindings = [
    (name = "PROVISIONER", durableObjectNamespace = "ProvisionerDO"),

    # Config vars — set by docker-compose.yml.
    (name = "SUPABASE_URL",  fromEnvironment = "SUPABASE_URL"),
    (name = "FRONTEND_URL",  fromEnvironment = "FRONTEND_URL"),
    (name = "API_URL",       fromEnvironment = "API_URL"),
    (name = "CORS_ALLOWED_ORIGINS", fromEnvironment = "CORS_ALLOWED_ORIGINS"),

    # Secrets — taken from the container environment.
    (name = "ENCRYPTION_KEY",           fromEnvironment = "ENCRYPTION_KEY"),
    (name = "INTERNAL_SECRET",          fromEnvironment = "INTERNAL_SECRET"),
    (name = "STATE_SIGNING_SECRET",     fromEnvironment = "STATE_SIGNING_SECRET"),
    (name = "SUPABASE_JWT_SECRET",      fromEnvironment = "SUPABASE_JWT_SECRET"),
    (name = "SUPABASE_SERVICE_ROLE_KEY",fromEnvironment = "SUPABASE_SERVICE_ROLE_KEY"),
    (name = "OPENAI_API_KEY",           fromEnvironment = "OPENAI_API_KEY"),
  ],
);
