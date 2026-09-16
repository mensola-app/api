-- Add credits JSONB column to Movie table
-- Stores cast (top 10 by order) and key crew members (director, writers, DOP)
-- Each entry contains: id (TMDB id), name, profilePath
ALTER TABLE "Movie" ADD COLUMN IF NOT EXISTS "credits" JSONB NULL;
