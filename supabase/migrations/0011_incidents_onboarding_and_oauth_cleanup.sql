-- ============================================================
-- 0011_incidents_onboarding_and_oauth_cleanup.sql
-- ============================================================
-- Three objects the core WORKER talks to through `sb()` /
-- `scopedQuery()`, which the original extraction missed for the
-- mirror image of 0010's reason: that split was derived from the
-- worker's own core/cloud classification, and these three are read
-- by files that stayed in core while the code that WRITES them went
-- to cloud.
--
-- Each read swallows its own failure, so the symptom is silence:
-- PGRST205 is a 404, PostgREST logs nothing, and the caller falls
-- back to an empty result. Before this file, on a self-hosted stack:
--
--   * routes/workflowProvision.ts  GET /api/projects/health-overview
--     — one 404 per active project on every console index load
--       (console.index.tsx), reported back as "no incidents"
--   * routes/chat.ts               POST /api/chat
--     — one 404 per canvas chat message that has a project, so the
--       model silently never receives incident context
--   * routes/hooks.ts              POST /api/hooks/onboarding
--     — two 404s per signup (claim, then release), and the
--       idempotency marker that stops a duplicate welcome email is
--       never actually written
--   * routes/oauth.ts              GET /api/oauth/:service/callback
--     — the piggyback purge of expired state rows is a no-op, so
--       used_oauth_states (0008) grows unbounded for any operator
--       who configures a real OAuth provider
--
-- `incidents` has no writer in core — IncidentMonitorDO, uptimeCheck
-- and costCheck are all cloud. It ships anyway because the readers
-- are shared product code on hot paths, and a table that is reliably
-- empty answers them correctly at zero cost, where gating each call
-- site would put a cloud/core branch inside the chat and console
-- paths. Whether core should eventually GATE these reads instead is
-- a scope question, not a schema one — see MANIFEST.md.
--
-- Upstream sources: 024, 038, 043, 046 (incidents); 005
-- (user_onboarding_sent); 009, 022 (cleanup_expired_oauth_states).
-- Definitions reproduce the live schema; they do not improve on it.
-- ============================================================

-- ── incidents ───────────────────────────────────────────────
-- Runtime incident records: 5xx/error/warning from the log monitor,
-- 'down' from the uptime checker (043). `workflow_id` became
-- `project_id` in 038; the constraint and index names kept their
-- legacy workflow_* spelling, exactly as the live schema does.
CREATE TABLE public.incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    service text NOT NULL,
    resource_id text NOT NULL,
    deployment_id text,
    severity text NOT NULL,
    status_code integer,
    path text,
    log_snippet text,
    count integer DEFAULT 1 NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    resolved_at timestamp with time zone,
    caused_by_deployment_id text,
    CONSTRAINT incidents_severity_check CHECK ((severity = ANY (ARRAY['5xx'::text, 'error'::text, 'warning'::text, 'down'::text]))),
    CONSTRAINT incidents_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'acknowledged'::text])))
);

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_workflow_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- One open incident per (project, resource, severity, path). COALESCE
-- rather than a plain column list: NULL paths would otherwise never
-- collide, and every uptime incident has a NULL path.
CREATE UNIQUE INDEX incidents_open_unique ON public.incidents USING btree (project_id, resource_id, severity, COALESCE(path, ''::text)) WHERE (status = 'open'::text);

CREATE INDEX idx_incidents_workflow_open ON public.incidents USING btree (project_id) WHERE (status = 'open'::text);

CREATE INDEX idx_incidents_last_seen ON public.incidents USING btree (last_seen_at DESC);

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

-- SELECT and UPDATE only: rows are written by the service role, and a
-- user acknowledging one is the single mutation the UI offers.
CREATE POLICY "Users see own incidents" ON public.incidents FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY "Users can acknowledge own incidents" ON public.incidents FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

-- ── user_onboarding_sent ────────────────────────────────────
-- Idempotency marker for the welcome email. A DB table rather than
-- user_metadata so the flag is device- and session-independent and
-- cannot be overwritten by the client. RLS on with no policy at all:
-- only the service role can see or write it.
CREATE TABLE public.user_onboarding_sent (
    user_id uuid NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.user_onboarding_sent
    ADD CONSTRAINT user_onboarding_sent_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.user_onboarding_sent
    ADD CONSTRAINT user_onboarding_sent_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.user_onboarding_sent ENABLE ROW LEVEL SECURITY;

-- ── cleanup_expired_oauth_states ────────────────────────────
-- Purges used_oauth_states (0008) of rows past their 10-minute
-- window. Called fire-and-forget from the OAuth callback, which is
-- why nothing surfaces when it is missing. 022's hardening is
-- included, not just 009's original: empty search_path, and execute
-- revoked from everyone but service_role.
CREATE OR REPLACE FUNCTION public.cleanup_expired_oauth_states() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  delete from public.used_oauth_states where expires_at < now();
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_oauth_states() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_oauth_states() TO service_role;
