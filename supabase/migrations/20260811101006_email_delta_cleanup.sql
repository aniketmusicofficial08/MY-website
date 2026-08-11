-- Aniket Patel & Band — email delta cleanup
-- Project: ynhjbeuwfbdsrmzbpeiy
--
-- Removes the ZZTEST artefacts from the email verification run and the single temporary
-- admin account used to trigger the approval email. The real admin account
-- (aniketmusicofficial08@gmail.com) and all real data are untouched.
--
-- That temporary account's password was generated inside the database, read back once,
-- and destroyed with the account. It was never written to any file in this repository.

delete from public.booking_audit_log
where enquiry_id in (select id from public.booking_enquiries where name like 'ZZTEST%')
   or admin_user_id in (select id from auth.users where email like 'zztest-%@apb-verify.dev');

delete from public.booking_reservations
where enquiry_id in (select id from public.booking_enquiries where name like 'ZZTEST%');

delete from public.booking_enquiries where name like 'ZZTEST%';

delete from public.calendar_blocks
where created_by in (select id from auth.users where email like 'zztest-%@apb-verify.dev')
   or removed_by in (select id from auth.users where email like 'zztest-%@apb-verify.dev');

delete from public.admin_users
where user_id in (select id from auth.users where email like 'zztest-%@apb-verify.dev');

delete from auth.identities
where user_id in (select id from auth.users where email like 'zztest-%@apb-verify.dev');

delete from auth.users where email like 'zztest-%@apb-verify.dev';

-- Retire the temporary fixture history row so repository and remote history stay identical.
delete from supabase_migrations.schema_migrations where name like 'zz_%';
