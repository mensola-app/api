export const albumQueries = {
    likes: {
        get: `
            SELECT 
                al."id", 
                al."spotifyId", 
                al."title", 
                al."image", 
                al."releaseDate", 
                al."songCount", 
                al."createdAt",
                true AS "isLiked",
                COALESCE(
                    (
                        SELECT json_agg(json_build_object('id', a."id", 'spotifyId', a."spotifyId", 'name', a."name"))
                        FROM "AlbumArtist" aa
                        JOIN "Artist" a ON aa."artistId" = a."id"
                        WHERE aa."albumId" = al."id"
                    ), 
                    '[]'::json
                ) AS "artists"
            FROM "Interaction" i
            JOIN "Album" al ON i."targetId" = al."id"
            WHERE i."userId" = $1 AND i."targetType" = 'album' AND i."isLiked" = true
            ORDER BY i."interactedAt" DESC
            LIMIT $2 OFFSET $3;
        `,
        add: `
            INSERT INTO "Interaction" ("userId", "targetId", "targetType", "isLiked", "updatedAt")
            VALUES ($1, $2, 'album', true, NOW())
            ON CONFLICT ("userId", "targetId", "targetType") DO UPDATE
            SET "isLiked" = true, "updatedAt" = NOW()
            RETURNING "targetId" AS "albumId", "isLiked";
        `,
        remove: `
            WITH target_interaction AS (
                SELECT i.id, i.rating,
                       EXISTS (SELECT 1 FROM "Comment" c WHERE c."interactionId" = i.id) AS has_comment
                FROM "Interaction" i
                WHERE i."userId" = $1 AND i."targetId" = $2 AND i."targetType" = 'album'
            ),
            deleted AS (
                DELETE FROM "Interaction" i
                USING target_interaction ti
                WHERE i.id = ti.id
                  AND ti.rating IS NULL
                  AND NOT ti.has_comment
                RETURNING i."targetId" AS "albumId", false AS "isLiked"
            ),
            updated AS (
                UPDATE "Interaction" i
                SET "isLiked" = false, "updatedAt" = NOW()
                FROM target_interaction ti
                WHERE i.id = ti.id
                  AND (ti.rating IS NOT NULL OR ti.has_comment)
                RETURNING i."targetId" AS "albumId", false AS "isLiked"
            )
            SELECT * FROM deleted
            UNION ALL
            SELECT * FROM updated;
        `,
    },
    getById: `
        SELECT 
            al."id", 
            al."spotifyId", 
            al."title", 
            al."image", 
            al."releaseDate", 
            al."songCount", 
            al."createdAt",
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
                    FROM "AlbumArtist" aa
                    JOIN "Artist" a ON aa."artistId" = a."id"
                    WHERE aa."albumId" = al."id"
                ), 
                '[]'::json
            ) AS "artists",
            (
                SELECT COUNT(*)::int FROM "Interaction" i
                WHERE i."targetId" = al.id AND i."targetType" = 'album' AND i."isLiked" = true
            ) AS "likesCount",
            (
                SELECT COUNT(*)::int FROM "Interaction" i
                JOIN "Comment" c ON c."interactionId" = i.id
                WHERE i."targetId" = al.id AND i."targetType" = 'album' AND c."parentId" IS NULL
            ) AS "commentsCount",
            COALESCE(interactions_data.interactions, '[]') AS interactions,
            CASE WHEN user_int.user_interaction IS NOT NULL THEN (user_int.user_interaction->>'isLiked')::boolean ELSE false END AS "isLiked",
            user_int.user_interaction AS "currentUserInteraction"
        FROM "Album" al
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
                    al_int.id, 
                    al_int."rating", 
                    al_int."isLiked",
                    c.id AS cid, 
                    c.content, 
                    c."createdAt",
                    u.id AS uid, 
                    u.username, 
                    u.fullname, 
                    u.avatar,
                    (SELECT COUNT(*)::int FROM "CommentLike" cl WHERE cl."commentId" = c.id) AS "likesCount",
                    (SELECT COUNT(*)::int FROM "Comment" sub_c WHERE sub_c."interactionId" = al_int.id AND sub_c."parentId" IS NOT NULL) AS "replyCount",
                    CASE
                        WHEN $2::uuid IS NOT NULL
                        THEN EXISTS (SELECT 1 FROM "CommentLike" cl WHERE cl."commentId" = c.id AND cl."userId" = $2::uuid)
                        ELSE false
                    END AS "isLikedByMe"
                FROM "Interaction" al_int
                JOIN "Comment" c ON c."interactionId" = al_int.id AND c."parentId" IS NULL
                LEFT JOIN "User" u ON u.id = al_int."userId"
                WHERE al_int."targetId" = al.id AND al_int."targetType" = 'album'
                ORDER BY c."createdAt" DESC
                LIMIT 3
            ) int_data
        ) interactions_data ON true
        LEFT JOIN LATERAL (
            SELECT json_build_object(
                'id', cu_int.id,
                'rating', cu_int."rating",
                'isLiked', cu_int."isLiked",
                'comment', (
                    SELECT json_build_object('id', c.id, 'content', c.content, 'date', c."createdAt")
                    FROM "Comment" c
                    WHERE c."interactionId" = cu_int.id AND c."parentId" IS NULL
                    LIMIT 1
                )
            ) AS user_interaction
            FROM "Interaction" cu_int
            WHERE $2::uuid IS NOT NULL AND cu_int."userId" = $2::uuid AND cu_int."targetId" = al.id AND cu_int."targetType" = 'album'
        ) user_int ON true
        WHERE al.id = $1::uuid;
    `,

    checkExists: `
        SELECT *
        FROM "Album" a
        WHERE a."spotifyId" = $1`,

    insertAlbum: `
        INSERT INTO "Album" ("spotifyId", title, image, "releaseDate", "songCount", "createdAt")
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id`,

    insertAlbumArtist: `
        INSERT INTO "AlbumArtist" ("albumId", "artistId")
        VALUES ($1, $2)
        RETURNING *`,

    tracks: {
        checkExists: `
            SELECT id FROM "Album" WHERE id = $1::uuid;
        `,
        get: `
            SELECT 
                t."id", 
                t."spotifyId", 
                t."title", 
                t."duration", 
                t."image", 
                t."albumId", 
                t."createdAt",
                COALESCE(
                    i_like."isLiked",
                    false
                ) AS "isLiked",
                COALESCE(
                    (
                        SELECT json_agg(json_build_object('id', a."id", 'spotifyId', a."spotifyId", 'name', a."name"))
                        FROM "TrackArtist" ta
                        JOIN "Artist" a ON ta."artistId" = a."id"
                        WHERE ta."trackId" = t."id"
                    ), 
                    '[]'::json
                ) AS "artists"
            FROM "Track" t
            LEFT JOIN "Interaction" i_like ON i_like."userId" = $2::uuid AND i_like."targetId" = t.id AND i_like."targetType" = 'track' AND i_like."isLiked" = true
            WHERE t."albumId" = $1::uuid
            ORDER BY t."createdAt" ASC
            LIMIT $3 OFFSET $4;
        `,
    },
    interaction: {
        /**
         * $1 = targetId (album), $2 = limit, $3 = offset, $4 = currentUserId (nullable)
         */
        get: `
            SELECT
                i.id,
                i."rating",
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
              AND i."targetType" = 'album'
              AND c."parentId" IS NULL
            ORDER BY c."createdAt" DESC
            LIMIT $2 OFFSET $3;
        `,
        upsert: `
            INSERT INTO "Interaction" ("userId", "targetId", "targetType", "rating", "isLiked", "updatedAt")
            VALUES ($1, $2, 'album', $3, COALESCE($4, false), NOW())
            ON CONFLICT ("userId", "targetId", "targetType") DO UPDATE
            SET "rating" = EXCLUDED."rating",
                "isLiked" = COALESCE($4, "Interaction"."isLiked"),
                "updatedAt" = NOW()
            RETURNING id, "userId", "targetId", "targetType", "rating", "isLiked", "interactedAt", "updatedAt";
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
