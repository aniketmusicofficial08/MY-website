-- Aniket Patel & Band — verification run cleanup
-- Project: ynhjbeuwfbdsrmzbpeiy
--
-- Removes every artefact of the final verification run, scoped strictly to the ZZTEST
-- markers and the single temporary account used to exercise the admin-side flows. The real
-- admin account (aniketmusicofficial08@gmail.com) and all real data are untouched.
--
-- The temporary account existed only inside that run: created, used to prove the
-- unauthorized (403) and authorized paths, then deleted here along with its identity and
-- admin_users row. Its credentials were never written to any file in this repository.

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

-- Retire the temporary fixture history rows so the repository and the remote migration
-- history stay identical. Those migrations created and then removed test-only rows; they
-- contain no schema changes and nothing production depends on.
delete from supabase_migrations.schema_migrations where name like 'zz_%';
