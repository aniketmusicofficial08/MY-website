-- Aniket Patel & Band — booking system core schema
-- Project: ynhjbeuwfbdsrmzbpeiy

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'admin',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint admin_users_role_check check (role in ('admin', 'owner'))
);

create table if not exists public.booking_enquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text not null,
  event_type text not null,
  event_date date not null,
  location text not null,
  message text not null,
  status text not null default 'pending',
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  denied_at timestamptz,
  denied_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  admin_notes text,
  new_enquiry_email_status text,
  approval_email_status text,
  constraint booking_enquiries_status_check
    check (status in ('pending', 'approved', 'denied', 'cancelled')),
  constraint booking_enquiries_event_type_check
    check (event_type in (
      'Weddings', 'Corporate Events', 'Private Parties', 'Birthdays', 'Anniversaries',
      'Housewarming Ceremonies', 'Clubs', 'Cultural Events', 'Special Celebrations'
    )),
  constraint booking_enquiries_source_check check (source in ('website', 'admin', 'test')),
  constraint booking_enquiries_email_format_check
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'),
  constraint booking_enquiries_name_len_check check (char_length(name) between 2 and 120),
  constraint booking_enquiries_phone_len_check check (char_length(phone) between 6 and 32),
  constraint booking_enquiries_email_len_check check (char_length(email) <= 254),
  constraint booking_enquiries_location_len_check check (char_length(location) between 2 and 200),
  constraint booking_enquiries_message_len_check check (char_length(message) between 1 and 2000),
  constraint booking_enquiries_admin_notes_len_check
    check (admin_notes is null or char_length(admin_notes) <= 2000),
  constraint booking_enquiries_new_email_status_check
    check (new_enquiry_email_status is null
           or new_enquiry_email_status in ('sent', 'failed', 'not_configured')),
  constraint booking_enquiries_approval_email_status_check
    check (approval_email_status is null
           or approval_email_status in ('sent', 'failed', 'not_configured'))
);

create table if not exists public.booking_reservations (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.booking_enquiries (id) on delete restrict,
  reserved_date date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  released_at timestamptz,
  released_by uuid references auth.users (id) on delete set null
);

-- DATABASE-LEVEL double-booking guarantee: at most one active reservation per date.
create unique index if not exists booking_reservations_one_active_per_date
  on public.booking_reservations (reserved_date) where active;

-- An enquiry can hold at most one active reservation.
create unique index if not exists booking_reservations_one_active_per_enquiry
  on public.booking_reservations (enquiry_id) where active;

create table if not exists public.calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  blocked_date date not null,
  reason text,
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_by uuid references auth.users (id) on delete set null,
  removed_at timestamptz,
  constraint calendar_blocks_reason_len_check check (reason is null or char_length(reason) <= 200)
);

-- Prevent duplicate active blocks for the same date.
create unique index if not exists calendar_blocks_one_active_per_date
  on public.calendar_blocks (blocked_date) where active;

create table if not exists public.booking_audit_log (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid references public.booking_enquiries (id) on delete set null,
  admin_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  old_status text,
  new_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint booking_audit_log_action_check check (action in (
    'created', 'approved', 'denied', 'cancelled',
    'date_blocked', 'date_unblocked', 'approval_email_retry'
  ))
);

create index if not exists booking_enquiries_status_created_idx
  on public.booking_enquiries (status, created_at desc);
create index if not exists booking_enquiries_event_date_idx
  on public.booking_enquiries (event_date);
create index if not exists booking_enquiries_denied_at_idx
  on public.booking_enquiries (denied_at desc) where status = 'denied';
create index if not exists booking_reservations_enquiry_idx
  on public.booking_reservations (enquiry_id);
create index if not exists booking_reservations_active_date_idx
  on public.booking_reservations (reserved_date) where active;
create index if not exists calendar_blocks_active_date_idx
  on public.calendar_blocks (blocked_date) where active;
create index if not exists booking_audit_log_enquiry_idx
  on public.booking_audit_log (enquiry_id, created_at desc);
create index if not exists booking_audit_log_admin_idx
  on public.booking_audit_log (admin_user_id);
create index if not exists booking_reservations_created_by_idx
  on public.booking_reservations (created_by);
create index if not exists booking_reservations_released_by_idx
  on public.booking_reservations (released_by);
create index if not exists calendar_blocks_created_by_idx
  on public.calendar_blocks (created_by);
create index if not exists calendar_blocks_removed_by_idx
  on public.calendar_blocks (removed_by);
create index if not exists booking_enquiries_approved_by_idx
  on public.booking_enquiries (approved_by);
create index if not exists booking_enquiries_denied_by_idx
  on public.booking_enquiries (denied_by);
create index if not exists booking_enquiries_cancelled_by_idx
  on public.booking_enquiries (cancelled_by);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists booking_enquiries_touch_updated_at on public.booking_enquiries;
create trigger booking_enquiries_touch_updated_at
  before update on public.booking_enquiries
  for each row execute function public.touch_updated_at();

comment on table public.booking_enquiries is 'Customer booking enquiries submitted from the public website. Contains PII — never exposed to anonymous users.';
comment on table public.booking_reservations is 'Confirmed date reservations. One active row per date is enforced by a unique partial index.';
comment on table public.calendar_blocks is 'Admin-blocked dates (holidays / unavailable). One active row per date.';
comment on table public.admin_users is 'Authorization allow-list for the admin dashboard, keyed to auth.users.';
comment on table public.booking_audit_log is 'Immutable audit trail of all admin actions.';
