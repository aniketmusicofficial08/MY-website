-- Aniket Patel & Band — email gate cleanup
-- Project: ynhjbeuwfbdsrmzbpeiy
--
-- Removes the clearly-marked ZZTEST enquiries used to probe Resend configuration.
-- Scoped to the ZZTEST prefix only; no real data is affected.

delete from public.booking_audit_log
where enquiry_id in (select id from public.booking_enquiries where name like 'ZZTEST%');

delete from public.booking_enquiries where name like 'ZZTEST%';
