-- ============================================================
-- 0007_provisioning.sql
-- ============================================================
-- provisioning_sessions, provisioning_events, deployment_logs.
--
-- deployment_logs is authored from the LIVE (006) shape only. The
-- migration history has a dead 002 definition (deployment_id/node_*/
-- data) that is never used; production code (provisioner.do.ts,
-- step_complete RPC, insights collectors) reads/writes the 006
-- columns stack_id/session_id/level/service/message/metadata. This
-- table is validated by column-match against 006, not by the replay
-- diff (see plan Task 1 corrections).
--
-- Sources: 003 (sessions), 035 (events), 006 (deployment_logs).
-- ============================================================

-- ── provisioning_sessions ───────────────────────────────────
CREATE TABLE public.provisioning_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stack_id uuid NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    current_step integer DEFAULT 0,
    total_steps integer DEFAULT 0,
    steps jsonb DEFAULT '[]'::jsonb,
    error_message text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT provisioning_sessions_status_check CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.provisioning_sessions
    ADD CONSTRAINT provisioning_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.provisioning_sessions
    ADD CONSTRAINT provisioning_sessions_stack_id_fkey FOREIGN KEY (stack_id) REFERENCES public.stacks(id) ON DELETE CASCADE;

CREATE INDEX sessions_stack_id_idx ON public.provisioning_sessions USING btree (stack_id, started_at DESC);

ALTER TABLE public.provisioning_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY session_select_own ON public.provisioning_sessions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.stacks s
  WHERE ((s.id = provisioning_sessions.stack_id) AND (s.user_id = auth.uid())))));

-- ── provisioning_events ─────────────────────────────────────
CREATE TABLE public.provisioning_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stack_id uuid NOT NULL,
    session_id uuid NOT NULL,
    sequence bigint NOT NULL,
    type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.provisioning_events
    ADD CONSTRAINT provisioning_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.provisioning_events
    ADD CONSTRAINT provisioning_events_session_id_idempotency_key_key UNIQUE (session_id, idempotency_key);

ALTER TABLE ONLY public.provisioning_events
    ADD CONSTRAINT provisioning_events_session_id_sequence_key UNIQUE (session_id, sequence);

ALTER TABLE ONLY public.provisioning_events
    ADD CONSTRAINT provisioning_events_stack_id_fkey FOREIGN KEY (stack_id) REFERENCES public.stacks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.provisioning_events
    ADD CONSTRAINT provisioning_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.provisioning_sessions(id) ON DELETE CASCADE;

CREATE INDEX provisioning_events_stack_idx ON public.provisioning_events USING btree (stack_id, created_at);

ALTER TABLE public.provisioning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_select_own ON public.provisioning_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.stacks s
  WHERE ((s.id = provisioning_events.stack_id) AND (s.user_id = auth.uid())))));

-- ── deployment_logs (006 live shape, verbatim/idempotent) ───
-- Authored directly from 006 (the live shape). Kept in 006's
-- idempotent `if not exists` / inline-FK form so it applies cleanly
-- both on a fresh Supabase project (creates the table with inline
-- PK + FKs to stacks/provisioning_sessions) and under the CI harness
-- (whose shim pre-scaffolds a superset deployment_logs so the full-73
-- replay can run — the CREATE then no-ops). Not part of the 17-table
-- oracle diff; validated by column-match against 006.
create table if not exists public.deployment_logs (
  id          uuid        default gen_random_uuid() primary key,
  stack_id    uuid        references public.stacks(id) on delete cascade not null,
  session_id  uuid        references public.provisioning_sessions(id) on delete cascade not null,
  level       text        not null default 'info'
              check (level in ('info', 'warn', 'error')),
  service     text,
  message     text        not null,
  metadata    jsonb       default '{}'::jsonb,
  created_at  timestamptz default now() not null
);

create index if not exists deployment_logs_session_idx on public.deployment_logs (session_id, created_at asc);
create index if not exists deployment_logs_stack_idx   on public.deployment_logs (stack_id,   created_at desc);

alter table public.deployment_logs enable row level security;

drop policy if exists "logs_select_own" on public.deployment_logs;
create policy "logs_select_own" on public.deployment_logs
  for select using (
    exists (select 1 from public.stacks s where s.id = stack_id and s.user_id = auth.uid())
  );
