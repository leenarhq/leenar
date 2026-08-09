-- ============================================================
-- 0004_project_environments.sql
-- ============================================================
-- project_environments, project_env_node_state,
-- project_env_secret_overrides (originally workflow_environments /
-- workflow_env_node_state / workflow_env_secret_overrides; renamed
-- in 038, legacy constraint/index/policy names retained).
-- Sources: 030, 031, 032, 033, 038, 045.
-- ============================================================

-- ── project_environments ────────────────────────────────────
CREATE TABLE public.project_environments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    canvas jsonb DEFAULT '{"edges": [], "nodes": []}'::jsonb NOT NULL,
    parent_id uuid,
    canvas_version bigint DEFAULT 0 NOT NULL,
    canvas_locked_at timestamp with time zone,
    canvas_locked_by uuid,
    canvas_lock_reason text,
    branch_key text,
    CONSTRAINT workflow_environments_canvas_lock_reason_check CHECK ((canvas_lock_reason = ANY (ARRAY['provisioning'::text, 'deprovisioning'::text, 'manual'::text]))),
    CONSTRAINT workflow_environments_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 64))),
    CONSTRAINT workflow_environments_slug_check CHECK ((slug ~ '^[a-z0-9][a-z0-9-]{0,31}$'::text))
);

ALTER TABLE ONLY public.project_environments
    ADD CONSTRAINT workflow_environments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_environments
    ADD CONSTRAINT workflow_environments_workflow_id_slug_key UNIQUE (project_id, slug);

ALTER TABLE ONLY public.project_environments
    ADD CONSTRAINT workflow_environments_workflow_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_environments
    ADD CONSTRAINT workflow_environments_canvas_locked_by_fkey FOREIGN KEY (canvas_locked_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.project_environments
    ADD CONSTRAINT workflow_environments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.project_environments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX workflow_environments_one_default ON public.project_environments USING btree (project_id) WHERE (is_default = true);
CREATE INDEX workflow_environments_workflow_id_idx ON public.project_environments USING btree (project_id, display_order);

ALTER TABLE public.project_environments ENABLE ROW LEVEL SECURITY;

CREATE POLICY env_select_own ON public.project_environments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = project_environments.project_id) AND (p.user_id = auth.uid())))));
CREATE POLICY env_insert_own ON public.project_environments FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = project_environments.project_id) AND (p.user_id = auth.uid())))));
CREATE POLICY env_update_own ON public.project_environments FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = project_environments.project_id) AND (p.user_id = auth.uid())))));
CREATE POLICY env_delete_own ON public.project_environments FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.projects p
  WHERE ((p.id = project_environments.project_id) AND (p.user_id = auth.uid())))));

CREATE TRIGGER bump_canvas_version_environments BEFORE UPDATE ON public.project_environments FOR EACH ROW EXECUTE FUNCTION public.bump_canvas_version();
CREATE TRIGGER enforce_environment_limit BEFORE INSERT ON public.project_environments FOR EACH ROW EXECUTE FUNCTION public.check_environment_limit();

-- ── project_env_node_state ──────────────────────────────────
CREATE TABLE public.project_env_node_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    environment_id uuid NOT NULL,
    node_id text NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_env_node_state_node_id_check CHECK (((char_length(node_id) >= 1) AND (char_length(node_id) <= 256)))
);

ALTER TABLE ONLY public.project_env_node_state
    ADD CONSTRAINT workflow_env_node_state_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_env_node_state
    ADD CONSTRAINT workflow_env_node_state_environment_id_node_id_key UNIQUE (environment_id, node_id);

ALTER TABLE ONLY public.project_env_node_state
    ADD CONSTRAINT workflow_env_node_state_environment_id_fkey FOREIGN KEY (environment_id) REFERENCES public.project_environments(id) ON DELETE CASCADE;

CREATE INDEX workflow_env_node_state_env_idx ON public.project_env_node_state USING btree (environment_id);

ALTER TABLE public.project_env_node_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY env_state_select_own ON public.project_env_node_state FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.project_environments e
     JOIN public.projects p ON ((p.id = e.project_id)))
  WHERE ((e.id = project_env_node_state.environment_id) AND (p.user_id = auth.uid())))));
CREATE POLICY env_state_insert_own ON public.project_env_node_state FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.project_environments e
     JOIN public.projects p ON ((p.id = e.project_id)))
  WHERE ((e.id = project_env_node_state.environment_id) AND (p.user_id = auth.uid())))));
CREATE POLICY env_state_update_own ON public.project_env_node_state FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.project_environments e
     JOIN public.projects p ON ((p.id = e.project_id)))
  WHERE ((e.id = project_env_node_state.environment_id) AND (p.user_id = auth.uid())))));
CREATE POLICY env_state_delete_own ON public.project_env_node_state FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.project_environments e
     JOIN public.projects p ON ((p.id = e.project_id)))
  WHERE ((e.id = project_env_node_state.environment_id) AND (p.user_id = auth.uid())))));

-- ── project_env_secret_overrides ────────────────────────────
CREATE TABLE public.project_env_secret_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    environment_id uuid NOT NULL,
    node_id text NOT NULL,
    env_var_key text NOT NULL,
    value_encrypted text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_env_secret_overrides_env_var_key_check CHECK (((char_length(env_var_key) >= 1) AND (char_length(env_var_key) <= 256))),
    CONSTRAINT workflow_env_secret_overrides_node_id_check CHECK (((char_length(node_id) >= 1) AND (char_length(node_id) <= 256)))
);

ALTER TABLE ONLY public.project_env_secret_overrides
    ADD CONSTRAINT workflow_env_secret_overrides_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_env_secret_overrides
    ADD CONSTRAINT workflow_env_secret_overrides_environment_id_node_id_env_va_key UNIQUE (environment_id, node_id, env_var_key);

ALTER TABLE ONLY public.project_env_secret_overrides
    ADD CONSTRAINT workflow_env_secret_overrides_environment_id_fkey FOREIGN KEY (environment_id) REFERENCES public.project_environments(id) ON DELETE CASCADE;

CREATE INDEX workflow_env_secret_overrides_env_idx ON public.project_env_secret_overrides USING btree (environment_id, node_id);

ALTER TABLE public.project_env_secret_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY env_secret_select_own ON public.project_env_secret_overrides FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.project_environments e
     JOIN public.projects p ON ((p.id = e.project_id)))
  WHERE ((e.id = project_env_secret_overrides.environment_id) AND (p.user_id = auth.uid())))));
CREATE POLICY env_secret_insert_own ON public.project_env_secret_overrides FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.project_environments e
     JOIN public.projects p ON ((p.id = e.project_id)))
  WHERE ((e.id = project_env_secret_overrides.environment_id) AND (p.user_id = auth.uid())))));
CREATE POLICY env_secret_update_own ON public.project_env_secret_overrides FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.project_environments e
     JOIN public.projects p ON ((p.id = e.project_id)))
  WHERE ((e.id = project_env_secret_overrides.environment_id) AND (p.user_id = auth.uid())))));
CREATE POLICY env_secret_delete_own ON public.project_env_secret_overrides FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.project_environments e
     JOIN public.projects p ON ((p.id = e.project_id)))
  WHERE ((e.id = project_env_secret_overrides.environment_id) AND (p.user_id = auth.uid())))));
