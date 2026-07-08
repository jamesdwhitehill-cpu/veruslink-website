-- VerusLink Sync — date-specific availability.
--
-- Shifts the availability model from day-of-week recurring templates to
-- date-specific blocks (each block is a concrete calendar date + time range),
-- matching the cal.com-style month-calendar UI.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR. The vl_ tables live in the Search
-- Momentum project (tzthoqfzmiifvwjemxmy), whose MCP/CLI path is permission-
-- blocked, so DDL cannot be applied programmatically (same note as migrations
-- 002, 004 and 005). Idempotent: safe to run more than once.

-- 1. Add a concrete date column for date-based availability.
--    NULL = legacy weekly-template block (day_of_week set). New blocks always
--    set block_date; the overlap engine only counts rows where block_date is set.
ALTER TABLE vl_available_blocks ADD COLUMN IF NOT EXISTS block_date date;

-- day_of_week was NOT NULL for the weekly model. New date-specific blocks don't
-- carry one, so drop the NOT NULL constraint (keep the column for old rows).
ALTER TABLE vl_available_blocks ALTER COLUMN day_of_week DROP NOT NULL;

-- 2. Index date-range queries the overlap engine runs (code_id + block_date).
CREATE INDEX IF NOT EXISTS idx_vl_available_blocks_date
  ON vl_available_blocks(code_id, block_date);

-- 3. Widen the default schedule window (was 08:00–18:00) and lengthen the
--    default planning horizon (was 14 days). Owners can still override all three
--    per-code from the manage page's Schedule settings.
ALTER TABLE vl_codes
  ALTER COLUMN business_hours_start SET DEFAULT '07:00',
  ALTER COLUMN business_hours_end   SET DEFAULT '21:00',
  ALTER COLUMN days_ahead           SET DEFAULT 30;
