-- ============================================================
-- 0002_functions.sql
-- ============================================================
-- Trigger helper functions used by the core tables. Defined
-- before the table files so the CREATE TRIGGER statements that
-- reference them succeed. PL/pgSQL bodies are resolved at first
-- execution, so referencing tables created in later files is
-- safe here.
--
-- Upstream sources: 002 (set_updated_at), 033 (bump_canvas_version),
-- 025 (check_api_key_limit), 053 (check_environment_limit),
-- 030 + 057 (create_default_environment — final 057 body).
-- ============================================================

-- Auto-update updated_at on row modification.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Increment canvas_version whenever the canvas JSONB actually changes.
create or replace function public.bump_canvas_version()
returns trigger language plpgsql as $$
begin
  if new.canvas is distinct from old.canvas then
    new.canvas_version = old.canvas_version + 1;
  end if;
  return new;
end;
$$;

-- Cap of 10 API keys per user.
create or replace function public.check_api_key_limit()
returns trigger language plpgsql security definer as $$
begin
  if (select count(*) from public.api_keys where user_id = new.user_id) >= 10 then
    raise exception 'Maximum of 10 API keys allowed per user';
  end if;
  return new;
end;
$$;

-- Cap of 10 environments per project.
create or replace function public.check_environment_limit()
returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if (select count(*) from public.project_environments where project_id = new.project_id) >= 10 then
    raise exception 'Maximum of 10 environments allowed per project';
  end if;
  return new;
end;
$$;

-- Auto-create the default "Production" environment for a new project,
-- seeding its canvas from the project's canvas (057 final body).
create or replace function public.create_default_environment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_environments (project_id, name, slug, is_default, display_order, canvas)
  values (
    new.id,
    'Production',
    'production',
    true,
    0,
    coalesce(new.canvas, '{"nodes":[],"edges":[]}'::jsonb)
  );
  return new;
end;
$$;
