export const trackQueries = {
    /**
     * Query to get a track by its ID, optionally resolving current user interactions like rating, likes and comments.
     */
    getById: `
        SELECT 
            t."id", 
            t."spotifyId", 
            t."title", 
            t."duration", 
            t."image", 
            t."albumId", 
            t."createdAt",
            COALESCE(
                (
                    SELECT json_agg(
                        json_build_object(
                            'id', a."id", 
                            'spotifyId', a."spotifyId",
                            'name', a."name",
                            'avatar', a."image"
                        )
                    )
                    FROM "TrackArtist" ta
                    JOIN "Artist" a ON ta."artistId" = a."id"
                    WHERE ta."trackId" = t."id"
                ), 
                '[]'::json
            ) AS "artists",
            (
                SELECT COUNT(*)::int FROM "Interaction" i
                WHERE i."targetId" = t.id AND i."targetType" = 'track' AND i."isLiked" = true
            ) AS "likesCount",
            (
                SELECT COUNT(*)::int FROM "Interaction" i
                JOIN "Comment" c ON c."interactionId" = i.id
                WHERE i."targetId" = t.id AND i."targetType" = 'track' AND c."parentId" IS NULL
            ) AS "commentsCount",
            EXISTS (
                SELECT 1 FROM "PlaylistItem" mli
                JOIN "Playlist" ml ON ml.id = mli."playlistId"
                WHERE mli."trackId" = t.id AND ml."creatorId" = $2::uuid AND ml."listType" = 'favorites'
            ) AS "isFavorite",
            COALESCE(interactions_data.interactions, '[]') AS interactions,
            CASE WHEN user_int.user_interaction IS NOT NULL THEN (user_int.user_interaction->>'isLiked')::boolean ELSE false END AS "isLiked",
            user_int.user_interaction AS "currentUserInteraction"
        FROM "Track" t
        LEFT JOIN LATERAL (
            SELECT json_agg(
                json_build_object(
                    'id', int_data.id,
                    'user', json_build_object(
                        'id', int_data.uid,
                        'username', int_data.username,
                        'fullname', int_data.fullname,
                        'avatar', int_data.avatar
                    ),
                    'rating', int_data."rating",
                    'isLiked', COALESCE(int_data."isLiked", false),
                    'likesCount', int_data."likesCount",
                    'replyCount', int_data."replyCount",
                    'isLikedByMe', int_data."isLikedByMe",
                    'comment', json_build_object(
                        'id', int_data.cid,
                        'content', int_data.content,
                        'date', int_data."createdAt"
                    )
                )
            ) AS interactions
            FROM (
                SELECT 
                    t_int.id, 
                    t_int."rating", 
                    t_int."isLiked",
                    c.id AS cid, 
                    c.content, 
                    c."createdAt",
                    u.id AS uid, 
                    u.username, 
                    u.fullname, 
                    u.avatar,
                    (SELECT COUNT(*)::int FROM "CommentLike" cl WHERE cl."commentId" = c.id) AS "likesCount",
                    (SELECT COUNT(*)::int FROM "Comment" sub_c WHERE sub_c."interactionId" = t_int.id AND sub_c."parentId" IS NOT NULL) AS "replyCount",
                    CASE
                        WHEN $2::uuid IS NOT NULL
                        THEN EXISTS (SELECT 1 FROM "CommentLike" cl WHERE cl."commentId" = c.id AND cl."userId" = $2::uuid)
                        ELSE false
                    END AS "isLikedByMe"
                FROM "Interaction" t_int
                JOIN "Comment" c ON c."interactionId" = t_int.id AND c."parentId" IS NULL
                LEFT JOIN "User" u ON u.id = t_int."userId"
                WHERE t_int."targetId" = t.id AND t_int."targetType" = 'track'
                ORDER BY c."createdAt" DESC
                LIMIT 3
            ) int_data
        ) interactions_data ON true
        LEFT JOIN LATERAL (
            SELECT json_build_object(
                'id', cu_int.id,
                'rating', cu_int.rating,
                'isLiked', cu_int."isLiked",
                'comment', (
                    SELECT json_build_object('id', c.id, 'content', c.content, 'date', c."createdAt")
                    FROM "Comment" c
                    WHERE c."interactionId" = cu_int.id AND c."parentId" IS NULL
                    LIMIT 1
                )
            ) AS user_interaction
            FROM "Interaction" cu_int
            WHERE $2::uuid IS NOT NULL AND cu_int."userId" = $2::uuid AND cu_int."targetId" = t.id AND cu_int."targetType" = 'track'
        ) user_int ON true
        WHERE t.id = $1::uuid;
    `,

    checkExists: `
        SELECT *
        FROM "Track" t
        WHERE t."spotifyId" = $1`,

    insertTrack: `
        INSERT INTO "Track" ("spotifyId", "title", "duration", "image", "albumId", "createdAt")
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id`,

    insertTrackArtist: `
        INSERT INTO "TrackArtist" ("trackId", "artistId")
        VALUES ($1, $2)
        RETURNING *`,

    likes: {
        get: `
            SELECT 
                t."id", 
                t."spotifyId", 
                t."title", 
                t."duration", 
                t."image", 
                t."albumId", 
                t."createdAt",
                true AS "isLiked",
                COALESCE(
                    (
                        SELECT json_agg(json_build_object('id', a."id", 'spotifyId', a."spotifyId", 'name', a."name"))
                        FROM "TrackArtist" ta
                        JOIN "Artist" a ON ta."artistId" = a."id"
                        WHERE ta."trackId" = t."id"
                    ), 
                    '[]'::json
                ) AS "artists"
            FROM "Interaction" i
            JOIN "Track" t ON i."targetId" = t."id"
            WHERE i."userId" = $1 AND i."targetType" = 'track' AND i."isLiked" = true
            ORDER BY i."interactedAt" DESC
            LIMIT $2 OFFSET $3;
        `,
        add: `
            INSERT INTO "Interaction" ("userId", "targetId", "targetType", "isLiked", "updatedAt")
            VALUES ($1, $2, 'track', true, NOW())
            ON CONFLICT ("userId", "targetId", "targetType") DO UPDATE
            SET "isLiked" = true, "updatedAt" = NOW()
            RETURNING "targetId" AS "trackId", "isLiked";
        `,
        remove: `
            WITH target_interaction AS (
                SELECT i.id, i.rating,
                       EXISTS (SELECT 1 FROM "Comment" c WHERE c."interactionId" = i.id) AS has_comment
                FROM "Interaction" i
                WHERE i."userId" = $1 AND i."targetId" = $2 AND i."targetType" = 'track'
            ),
            deleted AS (
                DELETE FROM "Interaction" i
                USING target_interaction ti
                WHERE i.id = ti.id
                  AND ti.rating IS NULL
                  AND NOT ti.has_comment
                RETURNING i."targetId" AS "trackId", false AS "isLiked"
            ),
            updated AS (
                UPDATE "Interaction" i
                SET "isLiked" = false, "updatedAt" = NOW()
                FROM target_interaction ti
                WHERE i.id = ti.id
                  AND (ti.rating IS NOT NULL OR ti.has_comment)
                RETURNING i."targetId" AS "trackId", false AS "isLiked"
            )
            SELECT * FROM deleted
            UNION ALL
            SELECT * FROM updated;
        `,
    },
    favorites: {
        get: `
            SELECT 
                t."id", 
                t."spotifyId", 
                t."title", 
                t."duration", 
                t."image", 
                t."albumId", 
                t."createdAt",
                true AS "isFavorite",
                COALESCE(
                    (
                        SELECT json_agg(json_build_object('id', a."id", 'spotifyId', a."spotifyId", 'name', a."name"))
                        FROM "TrackArtist" ta
                        JOIN "Artist" a ON ta."artistId" = a."id"
                        WHERE ta."trackId" = t."id"
                    ), 
                    '[]'::json
                ) AS "artists"
            FROM "PlaylistItem" mli
            JOIN "Track" t ON mli."trackId" = t."id"
            JOIN "Playlist" ml ON ml.id = mli."playlistId"
            WHERE ml."listType" = 'favorites' AND ml."creatorId" = $1
            ORDER BY mli."addedAt" DESC
            LIMIT $2 OFFSET $3;
        `,
        add: `
            WITH existing_list AS (
                SELECT id FROM "Playlist" WHERE "listType" = 'favorites' AND "creatorId" = $1 LIMIT 1
            ),
            new_list AS (
                INSERT INTO "Playlist" ("title", "isPrivate", "listType", "creatorId")
                SELECT 'Favorites', true, 'favorites', $1
                WHERE NOT EXISTS (SELECT 1 FROM existing_list)
                RETURNING id
            ),
            target_list AS (
                SELECT id FROM existing_list UNION ALL SELECT id FROM new_list
            )
            INSERT INTO "PlaylistItem" ("playlistId", "trackId", "addedBy", "addedAt")
            SELECT id, $2, $1, NOW() FROM target_list
            ON CONFLICT ("playlistId", "trackId") DO NOTHING
            RETURNING *;
        `,
        remove: `
            DELETE FROM "PlaylistItem"
            WHERE "playlistId" IN (SELECT id FROM "Playlist" WHERE "listType" = 'favorites' AND "creatorId" = $1) AND "trackId" = $2
            RETURNING *;
        `,
    },
    items: {
        /**
         * Fetches all user interactions containing a comment for a specific track.
         */
        /**
         * $1 = targetId (track), $2 = limit, $3 = offset, $4 = currentUserId (nullable)
         */
        getInteractions: `
            SELECT
                i.id,
                i."rating"::float,
                COALESCE(i."isLiked", false) AS "isLiked",
                json_build_object(
                    'id', u.id,
                    'username', u.username,
                    'fullname', u.fullname,
                    'avatar', u.avatar
                ) AS "user",
                json_build_object(
                    'id', c.id,
                    'content', c.content,
                    'date', c."createdAt"
                ) AS "comment",
                (SELECT COUNT(*)::int FROM "CommentLike" cl WHERE cl."commentId" = c.id) AS "likesCount",
                (SELECT COUNT(*)::int FROM "Comment" sub_c WHERE sub_c."interactionId" = i.id AND sub_c."parentId" IS NOT NULL) AS "replyCount",
                CASE
                    WHEN $4::uuid IS NOT NULL
                    THEN EXISTS (SELECT 1 FROM "CommentLike" cl WHERE cl."commentId" = c.id AND cl."userId" = $4::uuid)
                    ELSE false
                END AS "isLikedByMe"
            FROM "Comment" c
            JOIN "Interaction" i ON c."interactionId" = i.id
            JOIN "User" u ON u.id = i."userId"
            WHERE i."targetId" = $1
              AND i."targetType" = 'track'
              AND c."parentId" IS NULL
            ORDER BY c."createdAt" DESC
            LIMIT $2 OFFSET $3;
        `,
    },
    interaction: {
        upsert: `
            INSERT INTO "Interaction" ("userId", "targetId", "targetType", "rating", "isLiked", "updatedAt")
            VALUES ($1, $2, 'track', $3, COALESCE($4, false), NOW())
            ON CONFLICT ("userId", "targetId", "targetType")
            DO UPDATE SET
                "rating" = EXCLUDED."rating",
                "isLiked" = EXCLUDED."isLiked",
                "updatedAt" = NOW()
            RETURNING id, "userId", "targetId", "targetType", "rating"::float, "isLiked", "interactedAt", "updatedAt";
        `,
        cleanupEmpty: `
            DELETE FROM "Interaction"
            WHERE id = $1
              AND "rating" IS NULL
              AND ("isLiked" = false OR "isLiked" IS NULL)
              AND NOT EXISTS (SELECT 1 FROM "Comment" WHERE "interactionId" = $1);
        `,
    },
};
