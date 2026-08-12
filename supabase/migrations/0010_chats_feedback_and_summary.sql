-- ============================================================
-- 0010_chats_feedback_and_summary.sql
-- ============================================================
-- Three objects the core WEB app talks to directly through
-- supabase-js, which the original extraction missed because it
-- reasoned about the API worker only.
--
-- The extraction manifest classified `chats` and `user_feedback` as
-- cloud-only. That was true of the WORKER (`routes/dashboardChats.ts` is in
-- registerCloudRoutes, and nothing server-side writes feedback) but
-- not of the browser: apps/web/src/lib/workflows.ts and
-- components/dashboard/FeedbackModal.tsx query both tables with the
-- user's own JWT, and both are reached from console.tsx — the core
-- console shell. `project_summary` was missed for a different
-- reason: that manifest enumerates tables, and it is a view.
--
-- Symptom before this file: "Failed to load projects. Could not find
-- the table 'public.project_summary' in the schema cache" on the
-- console index, and the same PGRST205 for `chats` behind the
-- sidebar conversation list and the chat→canvas entry point
-- (console.new.tsx creates a conversation on the first message).
--
-- Upstream sources: 038 (chats, project_summary), 015 (user_feedback).
-- Definitions are copied verbatim from those migrations — this file
-- reproduces the live schema, it does not improve on it.
-- ============================================================

-- ── chats ───────────────────────────────────────────────────
-- AI conversations that have no canvas. Distinct from
-- projects.chat_history, which is the per-project transcript.
CREATE TABLE public.chats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text DEFAULT 'New conversation'::text NOT NULL,
    chat_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own chats" ON public.chats USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

CREATE TRIGGER set_chats_updated_at BEFORE UPDATE ON public.chats FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── user_feedback ───────────────────────────────────────────
-- Insert-only by design: the policy grants INSERT and nothing else,
-- so a user cannot read back even their own rows.
CREATE TABLE public.user_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    message text NOT NULL,
    page text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_feedback_message_check CHECK (((char_length(message) >= 1) AND (char_length(message) <= 2000)))
);

ALTER TABLE ONLY public.user_feedback
    ADD CONSTRAINT user_feedback_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_feedback
    ADD CONSTRAINT user_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

CREATE INDEX user_feedback_created_at_idx ON public.user_feedback USING btree (created_at DESC);

ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own feedback" ON public.user_feedback FOR INSERT WITH CHECK ((auth.uid() = user_id));

-- ── project_summary ─────────────────────────────────────────
-- The console's project list. security_invoker = on is what makes
-- it safe: the view runs with the caller's privileges, so
-- projects' own RLS still applies through it. Without that a view
-- owned by a privileged role would leak every user's projects.
CREATE VIEW public.project_summary WITH (security_invoker='on') AS
 SELECT p.id,
    p.user_id,
    p.name,
    p.status,
    p.created_at,
    p.updated_at,
    jsonb_array_length((p.canvas -> 'nodes'::text)) AS node_count,
    jsonb_array_length((p.canvas -> 'edges'::text)) AS edge_count,
    COALESCE(d.deploy_count, (0)::bigint) AS deploy_count,
    d.last_deployed_at,
    d.last_deploy_status,
    d.last_deployment_id
   FROM (public.projects p
     LEFT JOIN LATERAL ( SELECT count(*) AS deploy_count,
            max(project_deployments.queued_at) AS last_deployed_at,
            ( SELECT project_deployments_1.status
                   FROM public.project_deployments project_deployments_1
                  WHERE (project_deployments_1.project_id = p.id)
                  ORDER BY project_deployments_1.queued_at DESC
                 LIMIT 1) AS last_deploy_status,
            ( SELECT project_deployments_1.id
                   FROM public.project_deployments project_deployments_1
                  WHERE (project_deployments_1.project_id = p.id)
                  ORDER BY project_deployments_1.queued_at DESC
                 LIMIT 1) AS last_deployment_id
           FROM public.project_deployments
          WHERE (project_deployments.project_id = p.id)) d ON (true));
