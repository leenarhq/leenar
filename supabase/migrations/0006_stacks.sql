-- ============================================================
-- 0006_stacks.sql
-- ============================================================
-- stacks + stack_services. The stacks -> projects FK keeps its
-- legacy name stacks_workflow_id_fkey (007 added it as workflow_id;
-- 038 renamed the column to project_id but not the constraint).
-- Sources: 003, 007, 030, 038.
-- ============================================================

-- ── stacks ──────────────────────────────────────────────────
CREATE TABLE public.stacks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    requirements jsonb,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid,
    environment_id uuid,
    CONSTRAINT stacks_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'provisioning'::text, 'ready'::text, 'error'::text])))
);

ALTER TABLE ONLY public.stacks
    ADD CONSTRAINT stacks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stacks
    ADD CONSTRAINT stacks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.stacks
    ADD CONSTRAINT stacks_workflow_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.stacks
    ADD CONSTRAINT stacks_environment_id_fkey FOREIGN KEY (environment_id) REFERENCES public.project_environments(id) ON DELETE SET NULL;

CREATE INDEX stacks_environment_id_idx ON public.stacks USING btree (environment_id);
CREATE INDEX stacks_user_id_idx ON public.stacks USING btree (user_id, created_at DESC);
CREATE INDEX stacks_workflow_id_idx ON public.stacks USING btree (project_id, created_at DESC);

ALTER TABLE public.stacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY stacks_select_own ON public.stacks FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY stacks_insert_own ON public.stacks FOR INSERT WITH CHECK ((auth.uid() = user_id));
CREATE POLICY stacks_update_own ON public.stacks FOR UPDATE USING ((auth.uid() = user_id));
CREATE POLICY stacks_delete_own ON public.stacks FOR DELETE USING ((auth.uid() = user_id));

CREATE TRIGGER stacks_updated_at BEFORE UPDATE ON public.stacks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── stack_services ──────────────────────────────────────────
CREATE TABLE public.stack_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stack_id uuid NOT NULL,
    service_type text NOT NULL,
    external_id text,
    display_url text,
    metadata jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text,
    provisioned_at timestamp with time zone,
    CONSTRAINT stack_services_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'provisioning'::text, 'ready'::text, 'error'::text])))
);

ALTER TABLE ONLY public.stack_services
    ADD CONSTRAINT stack_services_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stack_services
    ADD CONSTRAINT stack_services_stack_id_fkey FOREIGN KEY (stack_id) REFERENCES public.stacks(id) ON DELETE CASCADE;

CREATE INDEX stack_services_stack_id_idx ON public.stack_services USING btree (stack_id);

ALTER TABLE public.stack_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY svc_select_own ON public.stack_services FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.stacks s
  WHERE ((s.id = stack_services.stack_id) AND (s.user_id = auth.uid())))));
