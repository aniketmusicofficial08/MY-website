-- Aniket Patel & Band — housekeeping
-- Project: ynhjbeuwfbdsrmzbpeiy
--
-- Final removal of temporary verification-fixture history. A `zz_public_calendar_cleanup`
-- migration briefly created one approved booking and one blocked date so the public
-- calendar's colour states (green / red / gold / past) could be confirmed in a real browser
-- against real database state, then deleted them again.
--
-- Net effect on schema and data: zero. This file exists so supabase/migrations/ matches the
-- database's migration history exactly.

delete from supabase_migrations.schema_migrations
where name like 'zz_%';
