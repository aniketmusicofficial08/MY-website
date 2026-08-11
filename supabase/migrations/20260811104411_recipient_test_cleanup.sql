-- Aniket Patel & Band — verification cleanup
-- Project: ynhjbeuwfbdsrmzbpeiy
--
-- Removes ZZTEST artefacts from the success-layout fix and the email-recipient
-- verification, plus the single temporary admin account used to trigger an approval.
--
-- Every delete is scoped by the ZZTEST marker or the throwaway apb-verify.dev domain, so
-- genuine enquiries, reservations, calendar blocks and audit history are left untouched.
-- The real admin account (aniketmusicofficial08@gmail.com) is never affected.

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

delete from supabase_migrations.schema_migrations where name like 'zz_%';
