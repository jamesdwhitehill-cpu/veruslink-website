-- VerusLink Sync — add archive support to codes.
-- Additive, nullable column only. Co-located in the Search Momentum Supabase
-- project (tzthoqfzmiifvwjemxmy); touches only the vl_ table, never SM data.
-- A non-null archived_at hides the code from the owner dashboard and (paired
-- with is_active=false set by the app) stops it rendering publicly. Reversible.

ALTER TABLE vl_codes ADD COLUMN IF NOT EXISTS archived_at timestamptz;
