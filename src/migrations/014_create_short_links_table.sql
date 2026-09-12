-- ======================================================
-- Migration 014: Create short_links table
-- ======================================================

CREATE TABLE IF NOT EXISTS short_links (
    code VARCHAR(8) PRIMARY KEY,
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('movie_list', 'playlist', 'user')),
    target_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_short_links_target ON short_links (target_type, target_id);
