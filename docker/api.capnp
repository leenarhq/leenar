using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .mainWorker),
    # PROVISIONER DO storage'ı bu diske yazılır (volume ile kalıcı).
    (name = "do-disk", disk = (path = "do-state", writable = true)),
    # workerd'in varsayılan globalOutbound'u ("internet") sadece public IP'lere
    # izin verir (SSRF koruması) — Docker Compose'daki `kong` servisi private
    # bridge-network IP'sinde yaşadığı için worker'ın fetch()'i bu default ile
    # `connect() blocked by restrictPeers()` hatasıyla engellenir (doğrulandı:
    # Task 3 smoke testinde reprodüklendi). "public" izniyse OPENAI_API_KEY ile
    # yapılan gerçek internet çağrıları (api.openai.com) için gerekli — ikisi
    # birden lazım.
    #
    # tlsOptions ŞART ve iki parçası da ŞART (A/B/C deneyiyle doğrulandı):
    #   - tlsOptions hiç yoksa workerd bu network servisini TLS'siz kurar ve HER
    #     https:// fetch'i `expected tlsNetwork != nullptr; this HttpClient
    #     doesn't support HTTPS` ile patlar. workerd'in dahili "internet"
    #     servisinin aksine özel network servisleri TLS'i kendiliğinden almıyor.
    #   - `tlsOptions = ()` tek başına yetmez: TLS açılır ama trust store boş
    #     kalır → `certificate is not trusted; unable to get local issuer
    #     certificate`. trustBrowserCas = true, sistemdeki CA demetini kullanmasını
    #     söyler (Dockerfile.api runtime stage'inde ca-certificates kuruyor —
    #     node:22-bookworm-slim'de /etc/ssl/certs BOŞ gelir; ikisi bir arada
    #     olmadan çalışmaz).
    # Etkilediği her şey: OPENAI_API_KEY ile chat→canvas, GitHub/Vercel/Supabase
    # connector'ları — yani dışarı çıkan tüm provisioning yolu.
    (name = "outbound", network = (allow = ["public", "private"], tlsOptions = (trustBrowserCas = true))),
  ],
  sockets = [
    (name = "http", address = "*:8787", http = (), service = "main"),
  ],
);

const mainWorker :Workerd.Worker = (
  # Keep in sync with scripts/open-core/wrangler.core.toml's compatibility_date
  # (staged as workers/api/wrangler.toml) — this capnp, not the staged wrangler.toml,
  # is what actually drives runtime compat here.
  compatibilityDate = "2024-09-23",
  compatibilityFlags = ["nodejs_compat"],
  modules = [
    # NOTE: bundle name verified against actual `wrangler deploy --dry-run
    # --outdir=dist` output — wrangler 3.x emits `index.js` (not `worker.js`),
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

    # Config vars (Task 3'te compose bunları set eder; smoke için placeholder).
    (name = "SUPABASE_URL",  fromEnvironment = "SUPABASE_URL"),
    (name = "FRONTEND_URL",  fromEnvironment = "FRONTEND_URL"),
    (name = "API_URL",       fromEnvironment = "API_URL"),
    (name = "CORS_ALLOWED_ORIGINS", fromEnvironment = "CORS_ALLOWED_ORIGINS"),

    # Secrets — container env'inden.
    (name = "ENCRYPTION_KEY",           fromEnvironment = "ENCRYPTION_KEY"),
    (name = "INTERNAL_SECRET",          fromEnvironment = "INTERNAL_SECRET"),
    (name = "STATE_SIGNING_SECRET",     fromEnvironment = "STATE_SIGNING_SECRET"),
    (name = "SUPABASE_JWT_SECRET",      fromEnvironment = "SUPABASE_JWT_SECRET"),
    (name = "SUPABASE_SERVICE_ROLE_KEY",fromEnvironment = "SUPABASE_SERVICE_ROLE_KEY"),
    (name = "OPENAI_API_KEY",           fromEnvironment = "OPENAI_API_KEY"),
  ],
);
