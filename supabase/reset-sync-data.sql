-- VerusLink Sync — ONE-TIME DESTRUCTIVE DATA RESET.
--
-- ⚠️  This permanently deletes every VerusLink Sync row (owners, codes, blocks,
--     subscribers, change log). It is NOT a migration — do not add it to a
--     replayable migration chain. Run it once, by hand, in the Supabase SQL
--     Editor when intentionally starting fresh.
--
-- Order: children before parents (FKs are ON DELETE CASCADE, but explicit ordered
-- DELETEs avoid cascading into anything outside the vl_ set).

DELETE FROM vl_change_log;
DELETE FROM vl_subscribers;
DELETE FROM vl_available_blocks;
DELETE FROM vl_codes;
DELETE FROM vl_owners;

-- Confirm all tables are empty (every count should be 0).
SELECT 'vl_owners' AS table, count(*) FROM vl_owners
UNION ALL SELECT 'vl_codes',            count(*) FROM vl_codes
UNION ALL SELECT 'vl_available_blocks', count(*) FROM vl_available_blocks
UNION ALL SELECT 'vl_subscribers',      count(*) FROM vl_subscribers
UNION ALL SELECT 'vl_change_log',       count(*) FROM vl_change_log;
