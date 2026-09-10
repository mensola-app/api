/**
 * User Module SQL Queries Container
 *
 * Grouped into logical namespaces for better maintainability and editor intellisense:
 * - profile: Profile details, aggregated stats, and top favorites.
 * - relations: Follower and following pagination queries.
 * - actions: Follow/unfollow state mutation queries.
 */
export const userQueries = {
    /**
     * Profile & Statistics Queries
     */
    profile: {
        /**
         * Fetches comprehensive user profile data, stats, and top 3 favorite movies/tracks.
         *
         * Parameters:
         * $1 - Target User ID (uuid)
         * $2 - Requesting User ID (uuid | null)
         */
        get: `
            WITH viewer_access AS (
                SELECT 
                    u.id AS user_id,
                    u.username,
                    u.avatar,
                    u.fullname,
                    u.bio,
                    u."isPrivate",
                    CASE 
                        WHEN u."isPrivate" = false THEN true
                        WHEN u.id = $2::uuid THEN true
                        WHEN $2::uuid IS NOT NULL AND EXISTS (
                            SELECT 1 FROM "Follow" WHERE "followerId" = $2::uuid AND "followingId" = u.id AND "status" = 'accepted'
                        ) THEN true
                        ELSE false
                    END AS has_access,
                    CASE 
                        WHEN $2::uuid IS NOT NULL AND EXISTS (
                            SELECT 1 FROM "Follow" WHERE "followerId" = $2::uuid AND "followingId" = u.id AND "status" = 'accepted'
                        ) THEN true
                        ELSE false
                    END AS is_following,
                    CASE 
                        WHEN $2::uuid IS NOT NULL AND EXISTS (
                            SELECT 1 FROM "Follow" WHERE "followerId" = $2::uuid AND "followingId" = u.id AND "status" = 'pending'
                        ) THEN true
                        ELSE false
                    END AS is_pending,
                    CASE 
                        WHEN $2::uuid IS NOT NULL AND EXISTS (
                            SELECT 1 FROM "Follow" WHERE "followerId" = u.id AND "followingId" = $2::uuid AND "status" = 'pending'
                        ) THEN true
                        ELSE false
                    END AS has_pending_request_from_user
                FROM "User" u
                WHERE u.id = $1 AND u."deletedAt" IS NULL
            )
            SELECT 
                v.user_id AS id,
                v.username,
                v.avatar,
                v.fullname,
                v.bio,
                v."isPrivate",
                v.has_access AS "hasAccess",
                v.is_following AS "isFollowingByMe",
                v.is_pending AS "isPendingByMe",
                v.has_pending_request_from_user AS "hasPendingRequestFromUser",
                
                COALESCE(follow_stats.follower_count, 0) AS "followersCount",
                COALESCE(follow_stats.following_count, 0) AS "followingCount",
                COALESCE(watched_stats.count, 0) AS "watchedMoviesCount",
                
                CASE WHEN v.has_access THEN COALESCE(movie_lists.count, 0) ELSE 0 END AS "movieListCount",
                CASE WHEN v.has_access THEN COALESCE(playlists.count, 0) ELSE 0 END AS "playlistCount",
                CASE WHEN v.has_access THEN COALESCE(watchlists.count, 0) ELSE 0 END AS "watchlistMoviesCount",
                
                CASE WHEN v.has_access THEN COALESCE(fav_movies.movies, '[]'::json) ELSE '[]'::json END AS "favoriteMovies",
                CASE WHEN v.has_access THEN COALESCE(fav_tracks.tracks, '[]'::json) ELSE '[]'::json END AS "favoriteTracks",
                
                CASE WHEN v.has_access THEN COALESCE(stats.total_liked_movies, 0) ELSE 0 END AS "likedMoviesCount",
                CASE WHEN v.has_access THEN COALESCE(stats.total_liked_tracks, 0) ELSE 0 END AS "likedTracksCount",
                CASE WHEN v.has_access THEN COALESCE(stats.total_liked_playlists, 0) ELSE 0 END AS "likedPlaylistsCount",
                CASE WHEN v.has_access THEN COALESCE(stats.total_liked_movie_lists, 0) ELSE 0 END AS "likedMovieListsCount",
                CASE WHEN v.has_access THEN COALESCE(stats.total_liked_albums, 0) ELSE 0 END AS "likedAlbumsCount",
                
                CASE 
                    WHEN v.has_access AND $1 != $2::uuid 
                    THEN COALESCE(mutual_follows.list, '[]'::json)
                    ELSE NULL
                END AS "mutualFollowers"
        
            FROM viewer_access v
            
            LEFT JOIN (
                SELECT "creatorId" AS creator_id, COUNT(*) as count
                FROM "MovieList" 
                WHERE "listType" = 'custom' AND "creatorId" = $1 
                GROUP BY "creatorId"
            ) movie_lists ON v.user_id = movie_lists.creator_id
        
            LEFT JOIN (
                SELECT "creatorId" as creator_id, COUNT(*) as count
                FROM "Playlist"
                WHERE "listType" = 'custom' AND "creatorId" = $1
                GROUP BY "creatorId"
            ) playlists ON v.user_id = playlists.creator_id
            
            LEFT JOIN (
                SELECT 
                    user_favs.creator_id,
                    json_agg(
                        json_build_object(
                            'id', user_favs.movie_id,
                            'title', user_favs.title,
                            'poster', user_favs.poster,
                            'rating', user_favs.rating,
                            'isLiked', user_favs.is_liked,
                            'hasReview', user_favs.has_comment
                        ) ORDER BY user_favs.added_at DESC
                    ) AS movies
                FROM (
                    SELECT 
                        ml."creatorId" AS creator_id,
                        m.id AS movie_id,
                        m.title,
                        m.poster,
                        m_int.rating,
                        COALESCE(m_int."isLiked", false) AS is_liked,
                        mli."addedAt" AS added_at,
                        CASE WHEN COUNT(c.id) > 0 THEN true ELSE false END AS has_comment,
                        ROW_NUMBER() OVER (PARTITION BY ml."creatorId" ORDER BY mli."addedAt" DESC) as rn
                    FROM "MovieList" ml
                    JOIN "MovieListItem" mli ON ml.id = mli."movieListId"
                    JOIN "Movie" m ON mli."movieId" = m.id
                    LEFT JOIN "Interaction" m_int ON m_int."userId" = ml."creatorId" AND m_int."targetId" = m.id
                    LEFT JOIN "Comment" c ON c."interactionId" = m_int.id
                    WHERE ml."listType" = 'favorites' AND ml."creatorId" = $1
                    GROUP BY ml."creatorId", m.id, mli."addedAt", m_int.id
                ) user_favs
                WHERE user_favs.rn <= 3
                GROUP BY user_favs.creator_id
            ) fav_movies ON v.user_id = fav_movies.creator_id
            
            LEFT JOIN (
                SELECT 
                    user_favs.creator_id,
                    json_agg(
                        json_build_object(
                            'id', user_favs.track_id,
                            'title', user_favs.title,
                            'image', user_favs.image,
                            'duration', user_favs.duration,
                            'artists', user_favs.artists_list
                        ) ORDER BY user_favs.added_at DESC
                    ) AS tracks
                FROM (
                    SELECT 
                        pl."creatorId" AS creator_id,
                        t.id AS track_id,
                        t.title,
                        t.image,
                        t.duration,
                        pli."addedAt" AS added_at,
                        json_agg(
                            json_build_object(
                                'id', a.id,
                                'name', a.name
                            )
                        ) AS artists_list,
                        DENSE_RANK() OVER (PARTITION BY pl."creatorId" ORDER BY pli."addedAt" DESC) as rn
                    FROM "Playlist" pl
                    JOIN "PlaylistItem" pli ON pl.id = pli."playlistId"
                    JOIN "Track" t ON pli."trackId" = t.id
                    JOIN "TrackArtist" ta ON ta."trackId" = t.id
                    JOIN "Artist" a ON a.id = ta."artistId"
                    WHERE pl."listType" = 'favorites' AND pl."creatorId" = $1
                    GROUP BY pl."creatorId", t.id, pli."addedAt"
                ) user_favs
                WHERE user_favs.rn <= 3
                GROUP BY user_favs.creator_id
            ) fav_tracks ON v.user_id = fav_tracks.creator_id
            
            LEFT JOIN (
                SELECT 
                    "userId",
                    COUNT(CASE WHEN "targetType" = 'movie' AND "isLiked" = true THEN 1 END) AS total_liked_movies,
                    COUNT(CASE WHEN "targetType" = 'track' AND "isLiked" = true THEN 1 END) AS total_liked_tracks,
                    COUNT(CASE WHEN "targetType" = 'playlist' AND "isLiked" = true THEN 1 END) AS total_liked_playlists,
                    COUNT(CASE WHEN "targetType" = 'movieList' AND "isLiked" = true THEN 1 END) AS total_liked_movie_lists,
                    COUNT(CASE WHEN "targetType" = 'album' AND "isLiked" = true THEN 1 END) AS total_liked_albums
                FROM "Interaction"
                WHERE "userId" = $1
                GROUP BY "userId"
            ) stats ON v.user_id = stats."userId"
        
            LEFT JOIN (
                SELECT 
                    u_id,
                    SUM(is_follower) AS follower_count,
                    SUM(is_following) AS following_count
                FROM (
                    SELECT "followingId" AS u_id, COUNT(*) AS is_follower, 0 AS is_following
                    FROM "Follow" WHERE "followingId" = $1 AND "status" = 'accepted'
                    GROUP BY "followingId"
                    UNION ALL
                    SELECT "followerId" AS u_id, 0 AS is_follower, COUNT(*) AS is_following
                    FROM "Follow" WHERE "followerId" = $1 AND "status" = 'accepted'
                    GROUP BY "followerId"
                ) combined_follows
                GROUP BY u_id
            ) follow_stats ON v.user_id = follow_stats.u_id
        
            LEFT JOIN (
                SELECT ml."creatorId" as creator_id, COUNT(mli."movieId") as count
                FROM "MovieList" ml
                LEFT JOIN "MovieListItem" mli ON ml.id = mli."movieListId"
                WHERE ml."listType" = 'watchlist' AND ml."creatorId" = $1
                GROUP BY ml."creatorId"
            ) watchlists ON v.user_id = watchlists.creator_id
        
            LEFT JOIN (
                SELECT "userId", COUNT(DISTINCT "movieId") AS count
                FROM "WatchedMovie"
                WHERE "userId" = $1
                GROUP BY "userId"
            ) watched_stats ON v.user_id = watched_stats."userId"
        
            LEFT JOIN (
                SELECT
                    f."followingId" AS target_user_id,
                    json_agg(
                        json_build_object(
                            'id', u_sub.id,
                            'username', u_sub.username,
                            'fullname', u_sub.fullname
                        )
                    ) AS list
                FROM "Follow" f
                JOIN "User" u_sub ON f."followerId" = u_sub.id
                WHERE f."followingId" = $1 
                    AND f."status" = 'accepted'
                    AND $2::uuid IS NOT NULL
                    AND $1 != $2::uuid
                    AND f."followerId" IN (
                        SELECT "followingId"
                        FROM "Follow"
                        WHERE "followerId" = $2::uuid AND "status" = 'accepted'
                    )
                GROUP BY f."followingId"
            ) mutual_follows ON v.user_id = mutual_follows.target_user_id;`,

        softDelete: `
            UPDATE "User"
            SET "deletedAt" = NOW(), "updatedAt" = NOW()
            WHERE id = $1;
        `,

        /**
         * Generates a dynamic UPDATE query for modifying user profile fields.
         *
         * @param fields - Array of SQL assignment clauses (e.g. ['"fullname" = $1', '"bio" = $2'])
         * @param userIdPlaceholderIndex - The parameter index for the WHERE clause user ID
         */
        update: (fields: string[], userIdPlaceholderIndex: number) => `
            UPDATE "User"
            SET ${fields.join(", ")}
            WHERE "id" = $${userIdPlaceholderIndex}
            RETURNING id, username, fullname, bio, avatar;
        `,

        getAvatarById: `SELECT avatar FROM "User" WHERE id = $1`,
        getUsernameAndChangedAt: `
            SELECT username, "usernameChangedAt", "subscriptionTier"
            FROM "User"
            WHERE id = $1
        `,
        existsByUsername: `
            SELECT 1
            FROM "User"
            WHERE username = $1 AND id != $2
        `,
        checkUsername: `
            SELECT EXISTS (
                SELECT 1 FROM "User" WHERE username = $1
            ) AS "isTaken"
        `,
        updateUsername: `
            UPDATE "User"
            SET username = $1, "usernameChangedAt" = NOW()
            WHERE id = $2
            RETURNING id, username, "usernameChangedAt"
        `,
    },

    /**
     * Relationship Listing & Pagination Queries
     */
    relations: {
        /**
         * Fetches paginated followers for a specific user.
         *
         * Parameters:
         * $1 - Target User ID
         * $2 - Requesting User ID
         * $3 - LIMIT
         * $4 - OFFSET
         */
        getFollowers: `
            SELECT 
                u.id,
                u.username,
                u.fullname,
                u.avatar,
                EXISTS (
                    SELECT 1 FROM "Follow" f1 
                    WHERE f1."followerId" = $2 AND f1."followingId" = u.id AND f1."status" = 'accepted'
                ) AS "isFollowing",
                EXISTS (
                    SELECT 1 FROM "Follow" f_p 
                    WHERE f_p."followerId" = $2 AND f_p."followingId" = u.id AND f_p."status" = 'pending'
                ) AS "isPending",
                EXISTS (
                    SELECT 1 FROM "Follow" f2 
                    WHERE f2."followerId" = u.id AND f2."followingId" = $2 AND f2."status" = 'accepted'
                ) AS "isFollower"
            FROM "Follow" f
            JOIN "User" u ON f."followerId" = u.id
            WHERE f."followingId" = $1 AND f."status" = 'accepted'
            ORDER BY f."followedAt" DESC
            LIMIT $3 OFFSET $4;`,

        /**
         * Fetches paginated users followed by a specific user.
         *
         * Parameters:
         * $1 - Target User ID
         * $2 - Requesting User ID
         * $3 - LIMIT
         * $4 - OFFSET
         */
        getFollowing: `
            SELECT 
                u.id,
                u.username,
                u.fullname,
                u.avatar,
                EXISTS (
                    SELECT 1 FROM "Follow" f1 
                    WHERE f1."followerId" = $2 AND f1."followingId" = u.id AND f1."status" = 'accepted'
                ) AS "isFollowing",
                EXISTS (
                    SELECT 1 FROM "Follow" f_p 
                    WHERE f_p."followerId" = $2 AND f_p."followingId" = u.id AND f_p."status" = 'pending'
                ) AS "isPending",
                EXISTS (
                    SELECT 1 FROM "Follow" f2 
                    WHERE f2."followerId" = u.id AND f2."followingId" = $2 AND f2."status" = 'accepted'
                ) AS "isFollower"
            FROM "Follow" f
            JOIN "User" u ON f."followingId" = u.id
            WHERE f."followerId" = $1 AND f."status" = 'accepted'
            ORDER BY f."followedAt" DESC
            LIMIT $3 OFFSET $4;`,
    },

    /**
     * Mutation Queries (Follow / Unfollow Actions)
     */
    actions: {
        /**
         * Inserts a follow relationship between two users.
         *
         * Parameters:
         * $1 - Follower User ID
         * $2 - Following User ID
         * $3 - Status ('pending' | 'accepted')
         */
        follow: `
            INSERT INTO "Follow" ("followerId", "followingId", "status")
            VALUES ($1, $2, $3)
            ON CONFLICT ("followerId", "followingId") DO NOTHING;`,

        /**
         * Removes a follow relationship between two users.
         *
         * Parameters:
         * $1 - Follower User ID
         * $2 - Following User ID
         */
        unfollow: `
            DELETE FROM "Follow"
            WHERE "followerId" = $1 AND "followingId" = $2;`,
    },

    emailChange: {
        getVerification: `
            SELECT "newEmail", "code", "expiresAt"
            FROM "EmailChangeVerification"
            WHERE "userId" = $1;
        `,
        upsertVerification: `
            INSERT INTO "EmailChangeVerification" ("userId", "newEmail", "code", "expiresAt")
            VALUES ($1, $2, $3, $4)
            ON CONFLICT ("userId") DO UPDATE
            SET "newEmail" = EXCLUDED."newEmail",
                "code" = EXCLUDED."code",
                "expiresAt" = EXCLUDED."expiresAt",
                "createdAt" = NOW();
        `,
        deleteVerification: `
            DELETE FROM "EmailChangeVerification"
            WHERE "userId" = $1;
        `,
        updateEmail: `
            UPDATE "User"
            SET email = $1, "updatedAt" = NOW()
            WHERE id = $2
            RETURNING id, email, username;
        `,
        getPasswordHash: `
            SELECT password FROM "User" WHERE id = $1;
        `,
        existsByEmail: `
            SELECT 1 FROM "User" WHERE email = $1;
        `,
    },

    password: {
        update: `
            UPDATE "User"
            SET password = $1, "updatedAt" = NOW()
            WHERE id = $2;
        `,
    },

    privacy: {
        update: `
            UPDATE "User"
            SET "isPrivate" = $1, "updatedAt" = NOW()
            WHERE id = $2
            RETURNING id, email, username, "isPrivate";
        `,
    },

    /**
     * Search Queries
     */
    search: {
        /**
         * Search users by username or fullname using pg_trgm similarity.
         *
         * Parameters:
         * $1 - Search query (string)
         * $2 - Requesting User ID for following context (uuid | null)
         * $3 - LIMIT
         * $4 - OFFSET
         */
        byQuery: `
            SELECT 
                u.id,
                u.username,
                u.fullname,
                u.avatar,
                CASE 
                    WHEN $2::uuid IS NOT NULL AND EXISTS (
                        SELECT 1 FROM "Follow" WHERE "followerId" = $2::uuid AND "followingId" = u.id AND "status" = 'accepted'
                    ) THEN true
                    ELSE false
                END AS "isFollowingByMe",
                CASE 
                    WHEN $2::uuid IS NOT NULL AND EXISTS (
                        SELECT 1 FROM "Follow" WHERE "followerId" = $2::uuid AND "followingId" = u.id AND "status" = 'pending'
                    ) THEN true
                    ELSE false
                END AS "isPendingByMe",
                -- Calculate a similarity score (using GREATEST to pick the best match between username and fullname)
                GREATEST(
                    similarity(u.username, $1),
                    similarity(COALESCE(u.fullname, ''), $1)
                ) as sml
            FROM "User" u
            WHERE u."deletedAt" IS NULL 
              AND ($2::uuid IS NULL OR u.id != $2::uuid)
              AND (
                  u.username % $1 OR 
                  COALESCE(u.fullname, '') % $1
              )
            ORDER BY sml DESC, u.username ASC
            LIMIT $3 OFFSET $4;
        `
    },
};
