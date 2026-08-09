-- ============================================================
-- 0003_projects.sql
-- ============================================================
-- The `projects` table (originally `workflows`, renamed in 038;
-- constraints/indexes/triggers retain their legacy workflow_* /
-- workflows_* names, exactly as the live schema does).
-- Sources: 002, 011, 012, 030, 033, 036, 037, 038, 057.
-- ============================================================

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text DEFAULT 'New Workflow'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    canvas jsonb DEFAULT '{"edges": [], "nodes": [], "viewport": {"x": 0, "y": 0, "zoom": 1}}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    chat_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    canvas_version bigint DEFAULT 0 NOT NULL,
    canvas_locked_at timestamp with time zone,
    canvas_locked_by uuid,
    canvas_lock_reason text,
    use_events boolean DEFAULT false NOT NULL,
    CONSTRAINT workflows_canvas_edges_check CHECK (((canvas IS NULL) OR (jsonb_array_length(COALESCE((canvas -> 'edges'::text), '[]'::jsonb)) <= 200))),
    CONSTRAINT workflows_canvas_lock_reason_check CHECK ((canvas_lock_reason = ANY (ARRAY['provisioning'::text, 'deprovisioning'::text, 'manual'::text]))),
    CONSTRAINT workflows_canvas_nodes_check CHECK (((canvas IS NULL) OR (jsonb_array_length(COALESCE((canvas -> 'nodes'::text), '[]'::jsonb)) <= 50))),
    CONSTRAINT workflows_canvas_size_check CHECK (((canvas IS NULL) OR (octet_length((canvas)::text) < 262144))),
    CONSTRAINT workflows_chat_history_check CHECK (((chat_history IS NULL) OR (jsonb_array_length(chat_history) <= 50))),
    CONSTRAINT workflows_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'error'::text])))
);

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT workflows_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT workflows_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT workflows_canvas_locked_by_fkey FOREIGN KEY (canvas_locked_by) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX workflows_user_id_idx ON public.projects USING btree (user_id, updated_at DESC);

CREATE UNIQUE INDEX projects_one_sample_per_user ON public.projects USING btree (user_id) WHERE (name = 'Sample: Full-Stack App'::text);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflows_select_own ON public.projects FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY workflows_insert_own ON public.projects FOR INSERT WITH CHECK ((auth.uid() = user_id));
CREATE POLICY workflows_update_own ON public.projects FOR UPDATE USING ((auth.uid() = user_id));
CREATE POLICY workflows_delete_own ON public.projects FOR DELETE USING ((auth.uid() = user_id));

CREATE TRIGGER bump_canvas_version_workflows BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.bump_canvas_version();
CREATE TRIGGER workflows_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_create_default_environment AFTER INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.create_default_environment();
