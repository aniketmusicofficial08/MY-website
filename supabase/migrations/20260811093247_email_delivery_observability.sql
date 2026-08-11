-- Aniket Patel & Band — email delivery observability
-- Project: ynhjbeuwfbdsrmzbpeiy
--
-- Previously an email outcome was reduced to 'sent' / 'failed' / 'not_configured', which
-- tells an admin that something broke but never why. This records the provider's actual
-- response — HTTP status, message id on success, error body on failure — into the audit log,
-- which is admin-only readable. It makes delivery problems diagnosable without shell access
-- to the function logs.
--
-- The stored payload never contains the API key: only the provider's response body, plus the
-- from/to addresses already present elsewhere in the row.

alter table public.booking_audit_log
  drop constraint if exists booking_audit_log_action_check;

alter table public.booking_audit_log
  add constraint booking_audit_log_action_check check (action in (
    'created', 'approved', 'denied', 'cancelled',
    'date_blocked', 'date_unblocked', 'approval_email_retry',
    'email_attempt'
  ));

create or replace function public.record_email_attempt(
  p_enquiry_id uuid,
  p_kind text,
  p_status text,
  p_detail jsonb default '{}'::jsonb
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

  insert into public.booking_audit_log (enquiry_id, action, metadata)
  values (
    p_enquiry_id,
    'email_attempt',
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('kind', p_kind, 'status', p_status)
  );
end;
$$;

revoke all on function public.record_email_attempt(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_email_attempt(uuid, text, text, jsonb) to service_role;

comment on function public.record_email_attempt(uuid, text, text, jsonb) is
  'Records an email send outcome plus the provider response detail. service_role only.';
