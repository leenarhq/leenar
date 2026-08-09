-- ============================================================
-- 0005_project_deployments.sql
-- ============================================================
-- project_deployments (originally workflow_deployments; renamed in
-- 038, legacy constraint/index names retained).
-- Sources: 002, 020, 038, 040, 041, 045.
-- ============================================================

CREATE TABLE public.project_deployments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    deployed_by uuid NOT NULL,
    canvas_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    error_message text,
    provider_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    env_node_state_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    environment_id uuid,
    CONSTRAINT project_deployments_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'success'::text, 'failed'::text, 'cancelled'::text, 'rolled_back'::text])))
);

ALTER TABLE ONLY public.project_deployments
    ADD CONSTRAINT workflow_deployments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_deployments
    ADD CONSTRAINT workflow_deployments_workflow_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_deployments
    ADD CONSTRAINT workflow_deployments_deployed_by_fkey FOREIGN KEY (deployed_by) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_deployments
    ADD CONSTRAINT project_deployments_environment_id_fkey FOREIGN KEY (environment_id) REFERENCES public.project_environments(id) ON DELETE SET NULL;

CREATE INDEX deployments_deployed_by_idx ON public.project_deployments USING btree (deployed_by);
CREATE INDEX deployments_workflow_id_idx ON public.project_deployments USING btree (project_id, queued_at DESC);

ALTER TABLE public.project_deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY deployments_select_own ON public.project_deployments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.projects w
  WHERE ((w.id = project_deployments.project_id) AND (w.user_id = auth.uid())))));
CREATE POLICY deployments_insert_own ON public.project_deployments FOR INSERT WITH CHECK (((auth.uid() = deployed_by) AND (EXISTS ( SELECT 1
   FROM public.projects w
  WHERE ((w.id = project_deployments.project_id) AND (w.user_id = auth.uid()))))));
CREATE POLICY deployments_update_own ON public.project_deployments FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.projects w
  WHERE ((w.id = project_deployments.project_id) AND (w.user_id = auth.uid())))));
