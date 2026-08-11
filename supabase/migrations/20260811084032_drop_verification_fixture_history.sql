-- Aniket Patel & Band — housekeeping
-- Project: ynhjbeuwfbdsrmzbpeiy
--
-- During the build, four temporary `zz_test_fixtures_*` migrations were applied to verify
-- the auth, authorization, concurrency and 72-hour-denial behaviour against a real database.
-- They created two throwaway accounts plus sample enquiries and then deleted all of it, so
-- their net effect on schema and data is zero.
--
-- Their recorded SQL contained a password for accounts that no longer exist, and they were
-- never part of the application's schema, so their history rows are removed here. This keeps
-- supabase/migrations/ an exact match for the database's migration history.

delete from supabase_migrations.schema_migrations
where name like 'zz_test_fixtures_%';
