-- Aniket Patel & Band — security advisor hardening
-- Project: ynhjbeuwfbdsrmzbpeiy
--
-- The Supabase security linter flags SECURITY DEFINER functions that are reachable over
-- PostgREST. RLS policies must be able to call the admin check, but nothing should be able
-- to reach it as an HTTP endpoint. Fix: the real implementation lives in a `private` schema,
-- which PostgREST does not expose, and the public wrapper is locked to service_role.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users a
    where a.user_id = uid and a.active
  );
$$;

comment on function private.is_admin(uuid) is 'Authoritative admin check. Lives in the private schema so it is not reachable via PostgREST.';

revoke all on function private.is_admin(uuid) from public;
grant execute on function private.is_admin(uuid) to authenticated, service_role;

-- Public wrapper kept only so the SECURITY DEFINER booking functions keep working;
-- no client-facing role may execute it.
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin(uid);
$$;

revoke all on function public.is_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_admin(uuid) to service_role;

-- Repoint every policy at the private implementation.
drop policy if exists "admins read enquiries" on public.booking_enquiries;
create policy "admins read enquiries" on public.booking_enquiries
  for select to authenticated using (private.is_admin());

drop policy if exists "admins read reservations" on public.booking_reservations;
create policy "admins read reservations" on public.booking_reservations
  for select to authenticated using (private.is_admin());

drop policy if exists "admins read calendar blocks" on public.calendar_blocks;
create policy "admins read calendar blocks" on public.calendar_blocks
  for select to authenticated using (private.is_admin());

drop policy if exists "admins read admin users" on public.admin_users;
create policy "admins read admin users" on public.admin_users
  for select to authenticated using (private.is_admin());

drop policy if exists "admins read audit log" on public.booking_audit_log;
create policy "admins read audit log" on public.booking_audit_log
  for select to authenticated using (private.is_admin());

-- Dashboard counts are plain RLS-filtered SELECT counts from the client instead of an
-- RPC, so there is no SECURITY DEFINER surface for signed-in users at all.
drop function if exists public.admin_stats();

-- Pre-existing Supabase platform function (event trigger `ensure_rls`, owner postgres).
-- Not created by this project; only its public EXECUTE grant is withdrawn. Event triggers
-- are dispatched by the server and do not consult EXECUTE privileges, so this is inert.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
