-- ============================================================
-- 0001_extensions_and_roles.sql
-- ============================================================
-- Prerequisites the consolidated core schema assumes a real
-- Supabase project already provides. This file ships to
-- self-hosters applying core-migrations against a fresh
-- Postgres/Supabase database.
--
-- We deliberately do NOT (re)declare the `auth` schema,
-- auth.users, auth.uid()/auth.jwt()/auth.role(), or the Supabase
-- roles (anon/authenticated/service_role/...). A real Supabase
-- project provisions all of those; the .validate/ harness stubs
-- them for plain-Postgres CI only and is never shipped.
--
-- Keep this file minimal — only extensions the core tables and
-- functions actually depend on.
-- ============================================================

-- gen_random_uuid() column defaults across every core table.
create extension if not exists pgcrypto;
