-- Aniket Patel & Band — admin authorization helper + Row Level Security
-- Project: ynhjbeuwfbdsrmzbpeiy
--
-- Security model:
--   * anonymous (anon)  -> no access to any booking table whatsoever.
--   * authenticated     -> READ access only, and only if listed+active in admin_users.
--   * every mutation    -> performed by SECURITY DEFINER RPCs invoked by Edge Functions
--                          running with the service role, after JWT + admin validation.

create or replace function public.is_admin(uid uuid default auth.uid())
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

comment on function public.is_admin(uuid) is 'True when the given auth user is an active admin. SECURITY DEFINER so RLS policies can call it without recursion.';

revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated, service_role;

alter table public.booking_enquiries   enable row level security;
alter table public.booking_reservations enable row level security;
alter table public.calendar_blocks      enable row level security;
alter table public.admin_users          enable row level security;
alter table public.booking_audit_log    enable row level security;

alter table public.booking_enquiries   force row level security;
alter table public.booking_reservations force row level security;
alter table public.calendar_blocks      force row level security;
alter table public.admin_users          force row level security;
alter table public.booking_audit_log    force row level security;

-- Hard revoke: anonymous visitors hold no table privileges at all.
revoke all on public.booking_enquiries   from anon;
revoke all on public.booking_reservations from anon;
revoke all on public.calendar_blocks      from anon;
revoke all on public.admin_users          from anon;
revoke all on public.booking_audit_log    from anon;

-- Authenticated users may only ever read; RLS then narrows that to admins.
revoke all on public.booking_enquiries   from authenticated;
revoke all on public.booking_reservations from authenticated;
revoke all on public.calendar_blocks      from authenticated;
revoke all on public.admin_users          from authenticated;
revoke all on public.booking_audit_log    from authenticated;

grant select on public.booking_enquiries   to authenticated;
grant select on public.booking_reservations to authenticated;
grant select on public.calendar_blocks      to authenticated;
grant select on public.admin_users          to authenticated;
grant select on public.booking_audit_log    to authenticated;

drop policy if exists "admins read enquiries" on public.booking_enquiries;
create policy "admins read enquiries" on public.booking_enquiries
  for select to authenticated using (public.is_admin());

drop policy if exists "admins read reservations" on public.booking_reservations;
create policy "admins read reservations" on public.booking_reservations
  for select to authenticated using (public.is_admin());

drop policy if exists "admins read calendar blocks" on public.calendar_blocks;
create policy "admins read calendar blocks" on public.calendar_blocks
  for select to authenticated using (public.is_admin());

drop policy if exists "admins read admin users" on public.admin_users;
create policy "admins read admin users" on public.admin_users
  for select to authenticated using (public.is_admin());

drop policy if exists "admins read audit log" on public.booking_audit_log;
create policy "admins read audit log" on public.booking_audit_log
  for select to authenticated using (public.is_admin());

-- Auto-enrol the band owner as an admin the moment that auth user is created,
-- so no manual authorization step is needed after the password is set.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(new.email) = 'aniketmusicofficial08@gmail.com' then
    insert into public.admin_users (user_id, email, role, active)
    values (new.id, lower(new.email), 'owner', true)
    on conflict (user_id) do update set active = true, role = 'owner';
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_grant_admin on auth.users;
create trigger on_auth_user_created_grant_admin
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
