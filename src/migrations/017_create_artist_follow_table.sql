-- ======================================================
-- Migration 017: Create ArtistFollow table
-- ======================================================

CREATE TABLE IF NOT EXISTS "ArtistFollow" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    "artistId" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP DEFAULT NOW(),

    CONSTRAINT uq_artist_follow UNIQUE ("userId", "artistId")
);

-- Index for fetching all artists a user follows
CREATE INDEX IF NOT EXISTS idx_artist_follow_user ON "ArtistFollow" ("userId");

-- Index for counting followers of an artist
CREATE INDEX IF NOT EXISTS idx_artist_follow_artist ON "ArtistFollow" ("artistId");
