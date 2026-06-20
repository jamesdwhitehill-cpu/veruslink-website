-- VerusLink Sync — tighten RLS + clean up a test artifact.
--
-- WHY: migration 001 granted the anon role broad write access and unrestricted
-- read on vl_owners. Since then, all owner-scoped reads/writes were moved behind
-- session-gated server endpoints (api/sync-owner.js, api/sync-save.js,
-- api/sync-dashboard.js) that use the service key. The anon policies below are no
-- longer used by the app and are exploitable:
--   * anon SELECT vl_owners  -> email enumeration of every owner
--   * anon INSERT vl_owners  -> arbitrary owner rows
--   * anon INSERT vl_codes   -> unauthenticated code creation under any owner
--   * anon UPDATE vl_codes   -> anyone can rename / pause / resume any code
--   * anon INSERT/DELETE vl_available_blocks -> forge or wipe anyone's availability
--   * anon INSERT/SELECT vl_change_log       -> forge / read change history
--
-- WHAT STILL WORKS AFTER THIS (public pages, intentionally kept):
--   * "Public read vl_codes"            (view.html reads active codes)
--   * "Public read vl_available_blocks" (view.html / manage.html read the grid)
--   * "Anon insert vl_subscribers"      (public subscribe on view.html)
--   * "Anon select vl_available_blocks" (kept; redundant with Public read)
--
-- RUN THIS IN THE SUPABASE SQL EDITOR (the MCP/CLI path is permission-blocked for
-- this project). It is idempotent — safe to run more than once.

-- 0) FIRST, verify the live policy names match what we drop below. The SEC
--    hardening may have renamed/replaced some policies, so confirm before relying
--    on the drops. Run this and eyeball the result:
--
--    SELECT tablename, policyname, cmd, roles
--    FROM pg_policies
--    WHERE tablename LIKE 'vl_%'
--    ORDER BY tablename, cmd;
--
--    If a policy you want gone has a different name, add a matching DROP for it.

-- 1) Remove the exploitable anon policies (no error if already gone).
DROP POLICY IF EXISTS "Anon read vl_owners"   ON vl_owners;
DROP POLICY IF EXISTS "Anon insert vl_owners" ON vl_owners;

DROP POLICY IF EXISTS "Anon insert vl_codes"  ON vl_codes;
DROP POLICY IF EXISTS "Anon update vl_codes"  ON vl_codes;

DROP POLICY IF EXISTS "Anon insert vl_available_blocks" ON vl_available_blocks;
DROP POLICY IF EXISTS "Anon delete vl_available_blocks" ON vl_available_blocks;

DROP POLICY IF EXISTS "Anon insert vl_change_log" ON vl_change_log;
DROP POLICY IF EXISTS "Anon select vl_change_log" ON vl_change_log;

-- 2) Clean up an accidental test row created while probing RLS during the
--    dashboard build. (RLS blocks the anon role from deleting it; the service
--    role used by the SQL editor can.)
DELETE FROM vl_codes WHERE code = 'SYNC-TEST_PROBE_DELETEME';

-- 3) Sanity check — these should all return 0 rows for the anon role going
--    forward. (Informational; safe to run.)
--    SELECT count(*) FROM vl_owners;  -- as anon, should now be denied/empty
