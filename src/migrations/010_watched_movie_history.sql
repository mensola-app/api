ALTER TABLE "WatchedMovie" 
ALTER COLUMN "watchedAt" TYPE TIMESTAMPTZ USING "watchedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "watchedAt" SET NOT NULL,
ALTER COLUMN "watchedAt" SET DEFAULT NOW();

ALTER TABLE "WatchedMovie" 
ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS "idx_watched_movie_user_movie" 
ON "WatchedMovie" ("userId", "movieId");

CREATE INDEX IF NOT EXISTS "idx_watched_movie_user_watchedat" 
ON "WatchedMovie" ("userId", "watchedAt" DESC);
