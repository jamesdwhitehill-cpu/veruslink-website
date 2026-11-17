-- VerusLink Sync - rate-limit table + close the last anon policies.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR for the project the vl_ tables live in
-- (tzthoqfzmiifvwjemxmy, co-located with Search Momentum; its MCP/CLI path is
-- permission-blocked, same note as 002 and 004 to 006). Idempotent.
--
-- ORDER MATTERS: run this only AFTER the site deploy that moved view.html off the
-- anon key (view.html now reads codes and subscribes via /api/sync-public).
-- Every vl_ read/write in the app now goes through /api/sync-* with the service
-- key, which bypasses RLS, so after this the anon role has no access to any vl_
-- table. Touches only vl_ objects, never Search Momentum data.

-- 1) Rate-limit events for api/_rate-limit.js. Buckets are hashed (no raw IP or
--    email stored). Until this table exists the app falls back to per-instance
--    in-memory counting.
CREATE TABLE IF NOT EXISTS vl_rate_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vl_rate_events_bucket_time ON vl_rate_events (bucket, created_at);
CREATE INDEX IF NOT EXISTS idx_vl_rate_events_time ON vl_rate_events (created_at);
ALTER TABLE vl_rate_events ENABLE ROW LEVEL SECURITY;  -- no policies: service key only

-- 2) Drop the public/anon policies left by migration 001.
DROP POLICY IF EXISTS "Public read vl_codes"            ON vl_codes;
DROP POLICY IF EXISTS "Public read vl_available_blocks" ON vl_available_blocks;
DROP POLICY IF EXISTS "Anon select vl_available_blocks" ON vl_available_blocks;
DROP POLICY IF EXISTS "Anon insert vl_subscribers"      ON vl_subscribers;

-- 3) Check: this should return no rows that grant anon/public access on vl_ tables.
--    SELECT tablename, policyname, cmd, roles FROM pg_policies
--    WHERE tablename LIKE 'vl_%' ORDER BY tablename, cmd;
