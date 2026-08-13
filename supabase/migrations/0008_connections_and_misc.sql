-- ============================================================
-- 0008_connections_and_misc.sql
-- ============================================================
-- Remaining core tables with no cross-dependencies beyond
-- projects / project_environments / auth.users:
-- user_connections, db_query_snippets, api_keys,
-- used_oauth_states, user_webhooks, security_events,
-- stack_drifts, user_audit_log.
--
-- stack_drifts keeps the legacy stack_drifts_workflow_id_fkey name
-- (project_id column). security_events includes the `weight` column
-- (068) and stack_drifts includes the reconcile columns (070); both
-- are written by the cloud abuse/reconcile layers but live on these
-- core-written tables — kept as columns, no cloud tables imported.
--
-- Upstream sources: 003 (user_connections), 072 (db_query_snippets),
-- 025 + 060 (api_keys), 008 (used_oauth_states),
-- 014 + 019 (user_webhooks), 021 + 068 (security_events),
-- 016 + 017 + 034 + 038 + 045 + 070 (stack_drifts),
-- 023 (user_audit_log).
-- ============================================================

-- ── user_connections ────────────────────────────────────────
CREATE TABLE public.user_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    service text NOT NULL,
    access_token_enc text NOT NULL,
    refresh_token_enc text,
    scopes text[],
    expires_at timestamp with time zone,
    connected_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.user_connections
    ADD CONSTRAINT user_connections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_connections
    ADD CONSTRAINT user_connections_user_id_service_key UNIQUE (user_id, service);

ALTER TABLE ONLY public.user_connections
    ADD CONSTRAINT user_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.user_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY connections_select_own ON public.user_connections FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY connections_insert_own ON public.user_connections FOR INSERT WITH CHECK ((auth.uid() = user_id));
CREATE POLICY connections_delete_own ON public.user_connections FOR DELETE USING ((auth.uid() = user_id));

-- ── db_query_snippets ───────────────────────────────────────
CREATE TABLE public.db_query_snippets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    node_id text NOT NULL,
    name text NOT NULL,
    sql text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.db_query_snippets
    ADD CONSTRAINT db_query_snippets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.db_query_snippets
    ADD CONSTRAINT db_query_snippets_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.db_query_snippets
    ADD CONSTRAINT db_query_snippets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX idx_db_query_snippets_user_node ON public.db_query_snippets USING btree (user_id, project_id, node_id, created_at DESC);

ALTER TABLE public.db_query_snippets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own db_query_snippets" ON public.db_query_snippets USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

-- ── api_keys ────────────────────────────────────────────────
CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    key_hash text NOT NULL,
    key_prefix text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    scope text DEFAULT 'read'::text NOT NULL,
    CONSTRAINT api_keys_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 64))),
    CONSTRAINT api_keys_scope_check CHECK ((scope = ANY (ARRAY['read'::text, 'write'::text])))
);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own api keys" ON public.api_keys USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

CREATE TRIGGER enforce_api_key_limit BEFORE INSERT ON public.api_keys FOR EACH ROW EXECUTE FUNCTION public.check_api_key_limit();

-- ── used_oauth_states ───────────────────────────────────────
CREATE TABLE public.used_oauth_states (
    hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.used_oauth_states
    ADD CONSTRAINT used_oauth_states_pkey PRIMARY KEY (hash);

CREATE INDEX used_oauth_states_expires_idx ON public.used_oauth_states USING btree (expires_at);

ALTER TABLE public.used_oauth_states ENABLE ROW LEVEL SECURITY;

-- ── user_webhooks ───────────────────────────────────────────
CREATE TABLE public.user_webhooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    url text NOT NULL,
    secret text NOT NULL,
    events text[] DEFAULT '{deploy_succeeded,deploy_failed}'::text[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.user_webhooks
    ADD CONSTRAINT user_webhooks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_webhooks
    ADD CONSTRAINT user_webhooks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX user_webhooks_user_id_idx ON public.user_webhooks USING btree (user_id) WHERE (active = true);

ALTER TABLE public.user_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own webhooks" ON public.user_webhooks USING ((auth.uid() = user_id));

-- ── security_events ─────────────────────────────────────────
CREATE TABLE public.security_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ip text NOT NULL,
    method text NOT NULL,
    path text NOT NULL,
    user_agent text,
    country text,
    reason text NOT NULL,
    blocked boolean DEFAULT true NOT NULL,
    weight integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);

CREATE INDEX security_events_created_idx ON public.security_events USING btree (created_at DESC);
CREATE INDEX security_events_ip_created_idx ON public.security_events USING btree (ip, created_at DESC);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- ── stack_drifts ────────────────────────────────────────────
CREATE TABLE public.stack_drifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    node_id text NOT NULL,
    service text NOT NULL,
    resource_id text NOT NULL,
    drift_type text NOT NULL,
    field text NOT NULL,
    expected jsonb,
    actual jsonb,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolution text,
    environment_id uuid,
    reconcile_attempts integer DEFAULT 0 NOT NULL,
    last_reconcile_error text,
    CONSTRAINT stack_drifts_drift_type_check CHECK ((drift_type = ANY (ARRAY['resource_missing'::text, 'env_removed'::text, 'env_stale'::text, 'domain_removed'::text, 'paused'::text]))),
    CONSTRAINT stack_drifts_resolution_check CHECK ((resolution = ANY (ARRAY['ignored'::text, 'auto_resolved'::text, 'reconciled'::text]))),
    CONSTRAINT stack_drifts_service_check CHECK ((service = ANY (ARRAY['vercel'::text, 'supabase'::text, 'github'::text, 'cloudflare'::text])))
);

ALTER TABLE ONLY public.stack_drifts
    ADD CONSTRAINT stack_drifts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stack_drifts
    ADD CONSTRAINT stack_drifts_workflow_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.stack_drifts
    ADD CONSTRAINT stack_drifts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.stack_drifts
    ADD CONSTRAINT stack_drifts_environment_id_fkey FOREIGN KEY (environment_id) REFERENCES public.project_environments(id) ON DELETE SET NULL;

CREATE INDEX idx_stack_drifts_environment ON public.stack_drifts USING btree (environment_id) WHERE (environment_id IS NOT NULL);
CREATE UNIQUE INDEX stack_drifts_open_unique ON public.stack_drifts USING btree (project_id, node_id, drift_type, field) WHERE (resolved_at IS NULL);
CREATE INDEX stack_drifts_open_workflow ON public.stack_drifts USING btree (project_id) WHERE (resolved_at IS NULL);

ALTER TABLE public.stack_drifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own drifts" ON public.stack_drifts FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY "Users can ignore own drifts" ON public.stack_drifts FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

-- ── user_audit_log ──────────────────────────────────────────
CREATE TABLE public.user_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    -- Which transport the action came in on: web | mcp | slack | whatsapp |
    -- agent | cron (075). Queryable rather than buried in metadata. Core
    -- writes it too — auditLog() in workers/api/src/utils.ts sets it from the
    -- auth middleware's transport — so a schema without this column fails
    -- every audit write with PGRST204, not just cloud's channel reporting.
    channel text
);

ALTER TABLE ONLY public.user_audit_log
    ADD CONSTRAINT user_audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_audit_log
    ADD CONSTRAINT user_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX user_audit_log_event_created_at_idx ON public.user_audit_log USING btree (event, created_at DESC);
CREATE INDEX user_audit_log_user_id_created_at_idx ON public.user_audit_log USING btree (user_id, created_at DESC);
CREATE INDEX user_audit_log_user_channel_idx ON public.user_audit_log USING btree (user_id, channel, created_at DESC);

ALTER TABLE public.user_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own audit logs" ON public.user_audit_log FOR SELECT USING ((auth.uid() = user_id));
