-- Aniket Patel & Band — QA booking test cleanup
-- Project: ynhjbeuwfbdsrmzbpeiy
--
-- Removes ONLY the authorized QA booking created during the end-to-end verification
-- of the public booking flow.
--
-- Scoped by primary key AND name AND status, deliberately NOT by email address. The
-- live production booking "Patel pranay" uses the same customer email
-- (nxtlucifer2296@gmail.com), so an email-scoped delete would have destroyed real data.
-- Identifiers were confirmed against the database before this ran.
--
-- Target: c598de52-faf7-4742-a173-4f34f7ba1c08 / "Website QA Test" / pending
-- The enquiry was never approved, so it held no reservation and blocked no date.
-- Post-run counts matched the pre-test baseline exactly.

delete from public.booking_audit_log
where enquiry_id = 'c598de52-faf7-4742-a173-4f34f7ba1c08'::uuid;

delete from public.booking_enquiries
where id = 'c598de52-faf7-4742-a173-4f34f7ba1c08'::uuid
  and name = 'Website QA Test'
  and status = 'pending';
