#!/bin/bash
# Runs during supabase/postgres container init (docker-entrypoint-initdb.d),
# AFTER the base image's own bundled init-scripts + baked-in
# /docker-entrypoint-initdb.d/migrate.sh have already provisioned the
# standard Supabase platform (auth/storage/realtime schemas, roles,
# ownership transfers, the `supabase_realtime` publication, etc.). This
# script applies the Leenar CORE migration set (0001..0009) on top of that.
#
# IMPORTANT — core migrations are mounted at .../initdb.d/core-migrations,
# NOT .../initdb.d/migrations. The supabase/postgres base image ships ~50 of
# its OWN baked-in platform migrations at .../initdb.d/migrations/*.sql
# (verified via `docker run --rm --entrypoint cat supabase/postgres:<tag>
# /docker-entrypoint-initdb.d/migrate.sh`, which globs and applies every
# *.sql under that exact directory). Mounting our core-migrations directly
# over that path replaces/hides the base image's own directory (bind mounts
# shadow, they don't merge), which breaks GoTrue (auth.uid()/auth.role()
# ownership never transferred from `postgres` to `supabase_auth_admin` —
# "must be owner of function uid") and Realtime (its `_realtime` schema is
# never created — "no schema has been selected to create in"). Confirmed by
# direct testing. Using a differently-named directory avoids the collision
# while still running as part of the same init pass, after the platform.
#
# Filename is prefixed `zz-` so it sorts (and therefore runs) after the base
# image's own init-scripts and its migrate.sh invocation.
set -e

MIGRATIONS_DIR="/docker-entrypoint-initdb.d/core-migrations"

# --- Role/grant/password backstop -------------------------------------
# core-migrations/0001_extensions_and_roles.sql deliberately does NOT
# declare Supabase roles/schemas (a real Supabase project — including this
# self-hosted supabase/postgres image — already provisions them via its own
# init-scripts + migrate.sh, which run before this script). If a future
# base image ever omits one of the roles GoTrue/PostgREST/Realtime require,
# create it here rather than editing the migration. The role/grant checks
# below no-op against the official image (all already exist by this point).
#
# The password ALTERs are NOT no-ops: the base image's own
# init-scripts/00000000000000-initial-schema.sql creates authenticator (and
# supabase_auth_admin/supabase_admin get no explicit password either) WITHOUT
# a password — fine for the base image's own local-socket bootstrap
# connections, but our compose's auth/rest/realtime services connect over
# TCP using POSTGRES_PASSWORD ("postgres"), which requires each role to
# actually have that password set. Verified by direct testing: without this,
# PostgREST fails "password authentication failed for user authenticator".
# Matches POSTGRES_PASSWORD used throughout this compose file (local demo
# only — see repo CLAUDE.md-adjacent docs for the fixed demo secrets).
#
# Connects as supabase_admin, NOT postgres: by the time this script runs,
# the base image's own migrations (e.g. revoke_admin_roles_from_postgres)
# have already demoted `postgres` and Supabase's reserved-role protection
# rejects `ALTER ROLE` on anon/authenticator/etc. from it ("... is a
# reserved role, only superusers can modify it" — confirmed by direct
# testing). supabase_admin retains the privilege the base image's own
# migrate.sh already relies on to modify these same roles.
psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres <<-'SQL'
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin noinherit createrole createdb replication bypassrls login password 'postgres';
  end if;
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin noinherit createrole login password 'postgres';
  end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'postgres';
  end if;
end $$;

-- authenticator is the role PostgREST connects as; it must be able to
-- switch into anon/authenticated/service_role per-request.
do $$ begin
  if not exists (
    select 1 from pg_auth_members m
    join pg_roles r on r.oid = m.roleid
    join pg_roles a on a.oid = m.member
    where r.rolname = 'anon' and a.rolname = 'authenticator'
  ) then
    grant anon to authenticator;
  end if;
  if not exists (
    select 1 from pg_auth_members m
    join pg_roles r on r.oid = m.roleid
    join pg_roles a on a.oid = m.member
    where r.rolname = 'authenticated' and a.rolname = 'authenticator'
  ) then
    grant authenticated to authenticator;
  end if;
  if not exists (
    select 1 from pg_auth_members m
    join pg_roles r on r.oid = m.roleid
    join pg_roles a on a.oid = m.member
    where r.rolname = 'service_role' and a.rolname = 'authenticator'
  ) then
    grant service_role to authenticator;
  end if;
end $$;

alter role authenticator with login password 'postgres';
alter role supabase_auth_admin with login password 'postgres';
alter role supabase_admin with login password 'postgres';

-- Realtime (DB_USER=supabase_admin, DB_AFTER_CONNECT_QUERY='SET search_path
-- TO _realtime' per the official self-host compose) expects its dedicated
-- `_realtime` schema to already exist before it runs its Ecto migrations —
-- unlike `realtime` (created by the base image's own
-- 20211118015519_create-realtime-schema.sql), `_realtime` is not created
-- anywhere in the base image. Without it, Realtime's migrator fails
-- "no schema has been selected to create in" and the container crash-loops
-- (confirmed by direct testing). Pre-create it here.
create schema if not exists _realtime authorization supabase_admin;
SQL

echo "init-migrations: role/grant/password backstop applied"

# --- Apply Leenar CORE migrations (0001..0009, filename order) --------
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "init-migrations: no migrations directory at $MIGRATIONS_DIR, skipping." >&2
  exit 0
fi

echo "init-migrations: applying core migrations from $MIGRATIONS_DIR (filename order)"
for f in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  echo "init-migrations: applying $f"
  psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$f"
done
echo "init-migrations: done"
