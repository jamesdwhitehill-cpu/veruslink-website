-- VerusLink Sync — availability broadcast tool
-- Co-located in the Search Momentum Supabase project (tzthoqfzmiifvwjemxmy).
-- All tables prefixed vl_ to avoid collision with existing SM tables.

-- Owners: people who create availability codes
CREATE TABLE IF NOT EXISTS vl_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Availability codes: the shareable identifier
CREATE TABLE IF NOT EXISTS vl_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES vl_owners(id) ON DELETE CASCADE,
  code text UNIQUE NOT NULL,         -- e.g., 'SYNC-JW7X' (auto-generated, 8 chars)
  label text NOT NULL,               -- e.g., "James Whitehill" or "Dr Smith - Physio"
  timezone text NOT NULL DEFAULT 'Australia/Sydney',
  slot_duration_minutes int NOT NULL DEFAULT 30,
  business_hours_start time NOT NULL DEFAULT '08:00',
  business_hours_end time NOT NULL DEFAULT '18:00',
  days_ahead int NOT NULL DEFAULT 14, -- how many days of availability to show
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Subscribers: people watching an availability code
CREATE TABLE IF NOT EXISTS vl_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id uuid NOT NULL REFERENCES vl_codes(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  subscribed_at timestamptz DEFAULT now(),
  unsubscribed_at timestamptz,
  UNIQUE(code_id, email)
);

-- Available blocks: when the owner IS available (inverse of busy)
CREATE TABLE IF NOT EXISTS vl_available_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id uuid NOT NULL REFERENCES vl_codes(id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Mon, 6=Sun
  start_time time NOT NULL,
  end_time time NOT NULL,
  valid_from date,    -- NULL = recurring weekly template
  valid_until date,   -- NULL = no expiry
  provider text NOT NULL DEFAULT 'manual',
  created_at timestamptz DEFAULT now()
);

-- Change log: track when availability was last modified (drives notifications)
CREATE TABLE IF NOT EXISTS vl_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id uuid NOT NULL REFERENCES vl_codes(id) ON DELETE CASCADE,
  changed_at timestamptz DEFAULT now(),
  change_summary text,
  notified boolean DEFAULT false
);

-- RLS: enable on all tables
ALTER TABLE vl_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE vl_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vl_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vl_available_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE vl_change_log ENABLE ROW LEVEL SECURITY;

-- Public read for codes and available blocks (anyone with the code can view)
CREATE POLICY "Public read vl_codes" ON vl_codes FOR SELECT USING (is_active = true);
CREATE POLICY "Public read vl_available_blocks" ON vl_available_blocks FOR SELECT USING (true);

-- Anon insert for subscribers (anyone can subscribe)
CREATE POLICY "Anon insert vl_subscribers" ON vl_subscribers FOR INSERT WITH CHECK (true);

-- Anon insert/read for owners (signup flow)
CREATE POLICY "Anon insert vl_owners" ON vl_owners FOR INSERT WITH CHECK (true);
CREATE POLICY "Anon read vl_owners" ON vl_owners FOR SELECT USING (true);

-- Anon insert/update for codes (owner creates/edits via manage page)
CREATE POLICY "Anon insert vl_codes" ON vl_codes FOR INSERT WITH CHECK (true);
CREATE POLICY "Anon update vl_codes" ON vl_codes FOR UPDATE USING (true);

-- Anon CRUD for available blocks (owner manages grid)
CREATE POLICY "Anon insert vl_available_blocks" ON vl_available_blocks FOR INSERT WITH CHECK (true);
CREATE POLICY "Anon delete vl_available_blocks" ON vl_available_blocks FOR DELETE USING (true);
CREATE POLICY "Anon select vl_available_blocks" ON vl_available_blocks FOR SELECT USING (true);

-- Anon insert/select for change log
CREATE POLICY "Anon insert vl_change_log" ON vl_change_log FOR INSERT WITH CHECK (true);
CREATE POLICY "Anon select vl_change_log" ON vl_change_log FOR SELECT USING (true);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_vl_codes_code ON vl_codes(code);
CREATE INDEX IF NOT EXISTS idx_vl_available_blocks_code_id ON vl_available_blocks(code_id);
CREATE INDEX IF NOT EXISTS idx_vl_subscribers_code_id ON vl_subscribers(code_id);
