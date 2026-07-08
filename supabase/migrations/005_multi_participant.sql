-- VerusLink Sync — multi-party participants.
--
-- Turns Sync from a one-way availability broadcast into group availability
-- coordination. `vl_subscribers` stay passive watchers; `vl_participants` are
-- active people who submit their OWN availability against a code. The owner is
-- also modelled as a participant (role='owner') so the overlap engine can treat
-- everyone's blocks uniformly (every block carries a participant_id).
--
-- RUN THIS IN THE SUPABASE SQL EDITOR. The vl_ tables live in the Search
-- Momentum project (tzthoqfzmiifvwjemxmy), whose MCP/CLI path is permission-
-- blocked, so DDL cannot be applied programmatically (same note as migrations
-- 002 and 004). Idempotent: safe to run more than once.

-- Participants: people invited to share their availability on a code
CREATE TABLE IF NOT EXISTS vl_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id uuid NOT NULL REFERENCES vl_codes(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  token text UNIQUE NOT NULL,          -- unique magic token for auth-free access
  role text NOT NULL DEFAULT 'participant' CHECK (role IN ('owner', 'participant')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'responded', 'declined')),
  invited_at timestamptz DEFAULT now(),
  responded_at timestamptz,
  UNIQUE(code_id, email)
);

-- Add participant_id to available_blocks
-- NULL = owner's blocks (backward compatible), UUID = participant's blocks
ALTER TABLE vl_available_blocks
  ADD COLUMN IF NOT EXISTS participant_id uuid REFERENCES vl_participants(id) ON DELETE CASCADE;

-- RLS
--
-- SECURITY: enable RLS with NO anon policies. Every read/write of vl_participants
-- in the app goes through a server endpoint using the service key (which bypasses
-- RLS): sync-participants.js, sync-respond.js, and the overlap engine. The anon
-- Supabase key is PUBLIC (it ships in view.html), so an "anon SELECT USING(true)"
-- policy here would let anyone harvest every participant's `token` and `email`.
-- The token is the auth for the respond page, so that is an account-takeover hole.
-- We therefore deliberately grant the anon role nothing on this table. Public
-- status counts and participant names are exposed safely, WITHOUT tokens/emails,
-- by the server-side /api/sync-overlap endpoint.
ALTER TABLE vl_participants ENABLE ROW LEVEL SECURITY;

-- Index for token lookups
CREATE INDEX IF NOT EXISTS idx_vl_participants_token ON vl_participants(token);
CREATE INDEX IF NOT EXISTS idx_vl_participants_code_id ON vl_participants(code_id);
CREATE INDEX IF NOT EXISTS idx_vl_available_blocks_participant ON vl_available_blocks(participant_id);
