-- ============================================================
-- 0009_rpcs.sql
-- ============================================================
-- The three CORE remote-procedure calls. Defined after all tables
-- so their PL/pgSQL bodies (which reference public.projects,
-- provisioning_sessions, provisioning_events, deployment_logs)
-- resolve cleanly.
--
-- Final-state bodies:
--   claim_canvas_lock  — 033 → 039 (projects rename) → 056 (owner scope)
--   release_canvas_lock — 033 → 039 (projects rename) → 076 (owner scope)
--   step_complete      — 073
-- ============================================================

-- ── claim_canvas_lock ───────────────────────────────────────
-- Atomically claims the per-project provision lock. Owner-scoped
-- (056): only touches a project the caller owns. Re-entrant.
CREATE OR REPLACE FUNCTION public.claim_canvas_lock(
  p_project_id  uuid,
  p_user_id     uuid,
  p_reason      text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.projects%ROWTYPE;
BEGIN
  UPDATE public.projects
  SET
    canvas_locked_at     = now(),
    canvas_locked_by     = p_user_id,
    canvas_lock_reason   = p_reason
  WHERE
    id      = p_project_id
    AND user_id = p_user_id
    AND (
      canvas_locked_at IS NULL
      OR canvas_locked_by = p_user_id
    )
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  SELECT * INTO v_row
  FROM public.projects
  WHERE id = p_project_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  RETURN jsonb_build_object(
    'ok',       false,
    'lockedBy', v_row.canvas_locked_by,
    'lockedAt', v_row.canvas_locked_at
  );
END;
$$;

-- Defense-in-depth: this RPC is only ever invoked server-side by the worker
-- with the service_role key (after app-layer JWT auth). Revoke the PostgREST
-- default grant so a self-hosted deployment can't let an authenticated client
-- call it directly and bypass the caller-identity/ownership assumptions.
revoke execute on function public.claim_canvas_lock(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.claim_canvas_lock(uuid, uuid, text) to service_role;

-- ── release_canvas_lock ─────────────────────────────────────
-- Clears the lock. No-op if already unlocked. Owner-scoped (076) when the
-- caller supplies p_user_id; nullable because some Durable Object exit paths
-- recover a lock with no user in hand, and a lock that cannot be released is
-- worse than one released unscoped. Returns whether a row was cleared.
-- LANGUAGE sql with a named dollar tag so the body survives a hand-paste into
-- the Supabase SQL editor (see migration 076 for the full reasoning).
CREATE OR REPLACE FUNCTION public.release_canvas_lock(
  p_project_id uuid,
  p_user_id    uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $release_canvas_lock$
  WITH cleared AS (
    UPDATE public.projects
       SET canvas_locked_at   = null,
           canvas_locked_by   = null,
           canvas_lock_reason = null
     WHERE id = p_project_id
       AND (p_user_id IS NULL OR user_id = p_user_id)
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM cleared)
$release_canvas_lock$;

-- Defense-in-depth: server-side/service_role only (see claim_canvas_lock note).
-- The in-body owner check above only binds when the caller passes p_user_id, so
-- this revoke is still what prevents a self-hosted authenticated client from
-- calling it directly with p_user_id omitted.
revoke execute on function public.release_canvas_lock(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.release_canvas_lock(uuid, uuid) to service_role;

-- ── step_complete ───────────────────────────────────────────
-- Collapses PATCH session + POST event + POST log into one call to
-- stay under the Cloudflare Workers subrequest cap.
CREATE OR REPLACE FUNCTION public.step_complete(
  p_session_id      uuid,
  p_stack_id        uuid,
  p_steps           jsonb,
  p_current_step    int,
  p_sequence        bigint,
  p_event_type      text,
  p_event_payload   jsonb,
  p_idempotency_key text,
  p_log_level       text,
  p_log_service     text,
  p_log_message     text,
  p_log_metadata    jsonb default '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  update public.provisioning_sessions
  set steps = p_steps, current_step = p_current_step
  where id = p_session_id;

  insert into public.provisioning_events
    (stack_id, session_id, sequence, type, payload, idempotency_key)
  values
    (p_stack_id, p_session_id, p_sequence, p_event_type, p_event_payload, p_idempotency_key)
  on conflict (session_id, idempotency_key) do nothing;

  insert into public.deployment_logs
    (stack_id, session_id, level, service, message, metadata)
  values
    (p_stack_id, p_session_id, p_log_level, p_log_service, p_log_message, p_log_metadata);
end;
$$;

revoke execute on function public.step_complete from public, anon, authenticated;
grant  execute on function public.step_complete to service_role;
