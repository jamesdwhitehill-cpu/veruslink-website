-- VerusLink Sync — email/password authentication support.
--
-- Adds a password_hash column to vl_owners so owners can sign in with an email +
-- password (see api/sync-auth.js) instead of the old client-side passphrase gate
-- and magic-link-only flow. The API endpoints authenticate server-side with the
-- service key, so no new RLS policy is needed for the auth path itself.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR (the MCP/CLI path is permission-blocked for
-- this project — see migration 002 for the same note). Idempotent: safe to re-run.

-- 1) Password hash column. Stored as `scrypt$<saltHex>$<hashHex>` (see sync-auth.js).
ALTER TABLE vl_owners ADD COLUMN IF NOT EXISTS password_hash text;

-- 2) Belt-and-braces: re-drop the exploitable anon policies (migration 002 already
--    removed these; repeated here so a fresh project is hardened in one paste).
--    The app authenticates server-side with the service key, which bypasses RLS,
--    so removing these does not affect the auth flow. Public read on vl_codes /
--    vl_available_blocks and anon subscribe on vl_subscribers are intentionally kept.
DROP POLICY IF EXISTS "Anon read vl_owners"   ON vl_owners;
DROP POLICY IF EXISTS "Anon insert vl_owners" ON vl_owners;
DROP POLICY IF EXISTS "Anon insert vl_codes"  ON vl_codes;
DROP POLICY IF EXISTS "Anon update vl_codes"  ON vl_codes;
