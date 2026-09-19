-- ======================================================
-- Migration 018: Add 'artist' to short_links target_type
--                and widen target_id from UUID to VARCHAR
-- ======================================================

-- 1. Widen target_id column from UUID to VARCHAR(255) so it can store Spotify IDs
ALTER TABLE short_links
    ALTER COLUMN target_id TYPE VARCHAR(255) USING target_id::VARCHAR(255);

-- 2. Drop old CHECK constraint and add new one that includes 'artist'
ALTER TABLE short_links
    DROP CONSTRAINT IF EXISTS short_links_target_type_check;

ALTER TABLE short_links
    ADD CONSTRAINT short_links_target_type_check
    CHECK (target_type IN ('movie_list', 'playlist', 'user', 'artist'));
