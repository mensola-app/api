export const artistQueries = {
    checkExists: `
        SELECT *
        FROM "Artist" a
        WHERE a."spotifyId" = $1`,

    insertArtist: `
        INSERT INTO "Artist" ("spotifyId", name, image, "createdAt")
        VALUES ($1, $2, $3, NOW())
        RETURNING id`,

    follow: {
        // Idempotent insert — returns the row whether newly inserted or already existing
        add: `
            INSERT INTO "ArtistFollow" ("userId", "artistId")
            VALUES ($1, $2)
            ON CONFLICT ("userId", "artistId") DO NOTHING
            RETURNING id, "userId", "artistId", "createdAt"`,

        // Delete follow relationship
        remove: `
            DELETE FROM "ArtistFollow"
            WHERE "userId" = $1 AND "artistId" = $2
            RETURNING id`,

        // Check if a user is following an artist
        check: `
            SELECT 1
            FROM "ArtistFollow"
            WHERE "userId" = $1 AND "artistId" = $2
            LIMIT 1`,

        // Count total followers for an artist
        getFollowerCount: `
            SELECT COUNT(*)::int AS "followerCount"
            FROM "ArtistFollow"
            WHERE "artistId" = $1`,
    },
};
