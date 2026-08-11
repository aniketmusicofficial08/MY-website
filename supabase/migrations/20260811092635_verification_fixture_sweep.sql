-- Aniket Patel & Band — housekeeping
-- Project: ynhjbeuwfbdsrmzbpeiy
--
-- 1. Removes any remaining clearly-marked ZZTEST verification records.
-- 2. Retires the temporary `zz_verification_cleanup` history row. That migration contained
--    only DELETE statements against ZZTEST test data plus history housekeeping — no schema
--    changes, no DDL, and nothing a production database depends on. Dropping its history row
--    is therefore safe: replaying supabase/migrations/ from scratch yields an identical
--    schema. This restores parity between the repository and the remote migration history so
--    future `db push` / `db reset` operations neither reapply nor skip real schema changes.
--
-- No production migration is removed by this file. The four migrations that define the
-- booking system — booking_core_schema, booking_rls_policies, booking_functions and
-- security_hardening — are untouched and remain the authoritative schema.

delete from public.booking_audit_log
where enquiry_id in (select id from public.booking_enquiries where name like 'ZZTEST%');

delete from public.booking_reservations
where enquiry_id in (select id from public.booking_enquiries where name like 'ZZTEST%');

delete from public.booking_enquiries where name like 'ZZTEST%';

delete from supabase_migrations.schema_migrations where name like 'zz_%';
