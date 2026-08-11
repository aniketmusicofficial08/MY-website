-- Aniket Patel & Band — atomic booking operations
-- Project: ynhjbeuwfbdsrmzbpeiy
--
-- Every mutating function is SECURITY DEFINER and executable ONLY by service_role.
-- Edge Functions validate the caller's JWT and admin membership before invoking them;
-- each function then re-verifies admin authorization itself (defence in depth).
--
-- Business failures are returned as {ok:false, error:'code'} rather than raised, so the
-- caller gets a clean contract. Writes that must not survive a failure are wrapped in
-- plpgsql exception blocks, which roll back to the block's savepoint.

-- ---------------------------------------------------------------- public: create enquiry
create or replace function public.create_enquiry(
  p_name text,
  p_phone text,
  p_email text,
  p_event_type text,
  p_event_date date,
  p_location text,
  p_message text,
  p_source text default 'website'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_event_date is null or p_event_date < v_today then
    return jsonb_build_object('ok', false, 'error', 'event_date_in_past');
  end if;

  if p_event_date > v_today + 730 then
    return jsonb_build_object('ok', false, 'error', 'event_date_too_far');
  end if;

  -- Re-check availability at write time: the visitor's calendar may be stale.
  if exists (select 1 from public.booking_reservations r
             where r.reserved_date = p_event_date and r.active) then
    return jsonb_build_object('ok', false, 'error', 'date_unavailable');
  end if;

  if exists (select 1 from public.calendar_blocks b
             where b.blocked_date = p_event_date and b.active) then
    return jsonb_build_object('ok', false, 'error', 'date_unavailable');
  end if;

  begin
    insert into public.booking_enquiries
      (name, phone, email, event_type, event_date, location, message, source)
    values
      (p_name, p_phone, p_email, p_event_type, p_event_date, p_location, p_message, p_source)
    returning id into v_id;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end;

  insert into public.booking_audit_log (enquiry_id, action, new_status, metadata)
  values (v_id, 'created', 'pending',
          jsonb_build_object('event_date', p_event_date, 'source', p_source));

  return jsonb_build_object('ok', true, 'enquiry_id', v_id);
end;
$$;

-- ---------------------------------------------------------------- public: availability
create or replace function public.get_availability(p_from date, p_to date)
returns table (day date, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d::date as day,
    case
      when exists (select 1 from public.booking_reservations r
                   where r.reserved_date = d::date and r.active) then 'booked'
      when exists (select 1 from public.calendar_blocks b
                   where b.blocked_date = d::date and b.active) then 'blocked'
      when d::date < (now() at time zone 'Asia/Kolkata')::date then 'past'
      else 'available'
    end as status
  from generate_series(
    p_from,
    least(p_to, p_from + 400),
    interval '1 day'
  ) as d;
$$;

comment on function public.get_availability(date, date) is 'Date availability only. Returns no customer information of any kind.';

-- ---------------------------------------------------------------- admin: approve
create or replace function public.approve_booking(p_enquiry_id uuid, p_admin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.booking_enquiries;
  v_res_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_admin(p_admin_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select * into v from public.booking_enquiries where id = p_enquiry_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'enquiry_not_found');
  end if;

  if v.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'enquiry_not_pending', 'status', v.status);
  end if;

  if v.event_date < v_today then
    return jsonb_build_object('ok', false, 'error', 'event_date_in_past');
  end if;

  if exists (select 1 from public.calendar_blocks b
             where b.blocked_date = v.event_date and b.active) then
    return jsonb_build_object('ok', false, 'error', 'date_blocked');
  end if;

  if exists (select 1 from public.booking_reservations r
             where r.reserved_date = v.event_date and r.active) then
    return jsonb_build_object('ok', false, 'error', 'date_already_reserved');
  end if;

  -- The unique partial index on (reserved_date) where active is the real guarantee:
  -- a concurrent approval for the same date loses here and rolls back.
  begin
    insert into public.booking_reservations (enquiry_id, reserved_date, created_by)
    values (v.id, v.event_date, p_admin_id)
    returning id into v_res_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'date_already_reserved');
  end;

  update public.booking_enquiries
     set status = 'approved',
         approved_at = now(),
         approved_by = p_admin_id,
         denied_at = null,
         denied_by = null,
         cancelled_at = null,
         cancelled_by = null
   where id = v.id;

  insert into public.booking_audit_log
    (enquiry_id, admin_user_id, action, old_status, new_status, metadata)
  values (v.id, p_admin_id, 'approved', v.status, 'approved',
          jsonb_build_object('reservation_id', v_res_id, 'event_date', v.event_date));

  return jsonb_build_object(
    'ok', true,
    'enquiry_id', v.id,
    'reservation_id', v_res_id,
    'name', v.name,
    'email', v.email,
    'event_type', v.event_type,
    'event_date', v.event_date,
    'location', v.location
  );
end;
$$;

-- ---------------------------------------------------------------- admin: deny
create or replace function public.deny_booking(p_enquiry_id uuid, p_admin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.booking_enquiries;
begin
  if not public.is_admin(p_admin_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select * into v from public.booking_enquiries where id = p_enquiry_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'enquiry_not_found');
  end if;

  if v.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'enquiry_not_pending', 'status', v.status);
  end if;

  update public.booking_enquiries
     set status = 'denied', denied_at = now(), denied_by = p_admin_id
   where id = v.id;

  insert into public.booking_audit_log
    (enquiry_id, admin_user_id, action, old_status, new_status, metadata)
  values (v.id, p_admin_id, 'denied', v.status, 'denied',
          jsonb_build_object('event_date', v.event_date));

  return jsonb_build_object('ok', true, 'enquiry_id', v.id);
end;
$$;

-- ---------------------------------------------------------------- admin: cancel
create or replace function public.cancel_booking(p_enquiry_id uuid, p_admin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.booking_enquiries;
  v_released int := 0;
begin
  if not public.is_admin(p_admin_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select * into v from public.booking_enquiries where id = p_enquiry_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'enquiry_not_found');
  end if;

  if v.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'enquiry_not_approved', 'status', v.status);
  end if;

  update public.booking_reservations
     set active = false, released_at = now(), released_by = p_admin_id
   where enquiry_id = v.id and active;
  get diagnostics v_released = row_count;

  update public.booking_enquiries
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_admin_id
   where id = v.id;

  insert into public.booking_audit_log
    (enquiry_id, admin_user_id, action, old_status, new_status, metadata)
  values (v.id, p_admin_id, 'cancelled', v.status, 'cancelled',
          jsonb_build_object('event_date', v.event_date, 'reservations_released', v_released));

  return jsonb_build_object('ok', true, 'enquiry_id', v.id, 'released', v_released);
end;
$$;

-- ---------------------------------------------------------------- admin: block a date
create or replace function public.block_date(p_date date, p_reason text, p_admin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_admin(p_admin_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if p_date is null or p_date < v_today then
    return jsonb_build_object('ok', false, 'error', 'date_in_past');
  end if;

  if exists (select 1 from public.booking_reservations r
             where r.reserved_date = p_date and r.active) then
    return jsonb_build_object('ok', false, 'error', 'date_reserved');
  end if;

  begin
    insert into public.calendar_blocks (blocked_date, reason, created_by)
    values (p_date, nullif(btrim(coalesce(p_reason, '')), ''), p_admin_id)
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'already_blocked');
  end;

  insert into public.booking_audit_log (admin_user_id, action, metadata)
  values (p_admin_id, 'date_blocked',
          jsonb_build_object('blocked_date', p_date, 'block_id', v_id, 'reason', p_reason));

  return jsonb_build_object('ok', true, 'block_id', v_id, 'blocked_date', p_date);
end;
$$;

-- ---------------------------------------------------------------- admin: unblock a date
create or replace function public.unblock_date(p_date date, p_admin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
begin
  if not public.is_admin(p_admin_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  update public.calendar_blocks
     set active = false, removed_at = now(), removed_by = p_admin_id
   where blocked_date = p_date and active;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_blocked');
  end if;

  insert into public.booking_audit_log (admin_user_id, action, metadata)
  values (p_admin_id, 'date_unblocked', jsonb_build_object('blocked_date', p_date));

  -- A date that also carries an active reservation stays booked, not available.
  return jsonb_build_object(
    'ok', true,
    'blocked_date', p_date,
    'still_reserved', exists (select 1 from public.booking_reservations r
                              where r.reserved_date = p_date and r.active)
  );
end;
$$;

-- ---------------------------------------------------------------- email bookkeeping
create or replace function public.set_email_status(
  p_enquiry_id uuid,
  p_kind text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'new_enquiry' then
    update public.booking_enquiries
       set new_enquiry_email_status = p_status where id = p_enquiry_id;
  elsif p_kind = 'approval' then
    update public.booking_enquiries
       set approval_email_status = p_status where id = p_enquiry_id;
  end if;
end;
$$;

create or replace function public.log_email_retry(p_enquiry_id uuid, p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.booking_audit_log (enquiry_id, admin_user_id, action, metadata)
  values (p_enquiry_id, p_admin_id, 'approval_email_retry', '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- admin dashboard counts
create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  return jsonb_build_object(
    'ok', true,
    'new_enquiries',
      (select count(*) from public.booking_enquiries where status = 'pending'),
    'approved_bookings',
      (select count(*) from public.booking_enquiries where status = 'approved'),
    'upcoming_bookings',
      (select count(*) from public.booking_enquiries
        where status = 'approved' and event_date >= v_today),
    'blocked_dates',
      (select count(*) from public.calendar_blocks where active and blocked_date >= v_today),
    'denied_recent',
      (select count(*) from public.booking_enquiries
        where status = 'denied' and denied_at > now() - interval '72 hours'),
    'email_failures',
      (select count(*) from public.booking_enquiries
        where approval_email_status = 'failed' or new_enquiry_email_status = 'failed')
  );
end;
$$;

-- ---------------------------------------------------------------- privilege lock-down
revoke all on function public.create_enquiry(text, text, text, text, date, text, text, text) from public, anon, authenticated;
revoke all on function public.get_availability(date, date)                                   from public, anon, authenticated;
revoke all on function public.approve_booking(uuid, uuid)                                    from public, anon, authenticated;
revoke all on function public.deny_booking(uuid, uuid)                                       from public, anon, authenticated;
revoke all on function public.cancel_booking(uuid, uuid)                                     from public, anon, authenticated;
revoke all on function public.block_date(date, text, uuid)                                   from public, anon, authenticated;
revoke all on function public.unblock_date(date, uuid)                                       from public, anon, authenticated;
revoke all on function public.set_email_status(uuid, text, text)                             from public, anon, authenticated;
revoke all on function public.log_email_retry(uuid, uuid)                                    from public, anon, authenticated;
revoke all on function public.admin_stats()                                                  from public, anon;
revoke all on function public.touch_updated_at()                                             from public, anon, authenticated;
revoke all on function public.handle_new_auth_user()                                         from public, anon, authenticated;

grant execute on function public.create_enquiry(text, text, text, text, date, text, text, text) to service_role;
grant execute on function public.get_availability(date, date)                                   to service_role;
grant execute on function public.approve_booking(uuid, uuid)                                    to service_role;
grant execute on function public.deny_booking(uuid, uuid)                                       to service_role;
grant execute on function public.cancel_booking(uuid, uuid)                                     to service_role;
grant execute on function public.block_date(date, text, uuid)                                   to service_role;
grant execute on function public.unblock_date(date, uuid)                                        to service_role;
grant execute on function public.set_email_status(uuid, text, text)                             to service_role;
grant execute on function public.log_email_retry(uuid, uuid)                                    to service_role;

-- Read-only aggregate: safe for a logged-in admin to call directly, guarded internally.
grant execute on function public.admin_stats() to authenticated, service_role;
