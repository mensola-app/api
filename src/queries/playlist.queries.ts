export const playlistQueries = {
    lists: {
        /**
         * Fetches playlists created by a specific user.
         * Shows private playlists only if the requester is the creator.
         */
        getUserPlaylists: `
            SELECT
                p.*,
                (
                    SELECT COUNT(*)::int
                    FROM "PlaylistItem" pi
                    WHERE pi."playlistId" = p.id
                ) AS "songCount",
                EXISTS (
                    SELECT 1 FROM "PlaylistItem" pi
                    WHERE pi."playlistId" = p.id AND ($5::uuid IS NOT NULL AND pi."trackId" = $5::uuid)
                ) AS "containsTrack"
            FROM "Playlist" p
            WHERE p."creatorId" = $1
              AND p."listType" = 'custom'
              AND (p."isPrivate" = false OR $1 = $2)
            ORDER BY p."updatedAt" DESC
            LIMIT $3 OFFSET $4;
        `,
        create: `
            INSERT INTO "Playlist" (id, title, description, image, "isPrivate", "creatorId", "listType", "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'custom', NOW(), NOW())
            RETURNING id, title, description, image, "isPrivate", "creatorId", "listType", "createdAt", "updatedAt";
        `,
        update: `
            UPDATE "Playlist" p
            SET 
                title = COALESCE($1, p.title),
                description = COALESCE($2, p.description),
                image = CASE WHEN $7::boolean = true THEN $3 ELSE p.image END,
                "isPrivate" = COALESCE($4, p."isPrivate"),
                "updatedAt" = NOW()
            WHERE p.id = $5 
              AND p."listType" = 'custom'
              AND (
                  p."creatorId" = $6 
                  OR EXISTS (
                      SELECT 1 FROM "PlaylistOwner" po 
                      WHERE po."playlistId" = p.id AND po."userId" = $6
                  )
              )
            RETURNING p.*;
        `,
        delete: `
            DELETE FROM "Playlist" p
            WHERE p.id = $1 
              AND p."listType" = 'custom'
              AND p."creatorId" = $2
            RETURNING *;
        `,
    },
    likes: {
        /**
         * Fetches playlists liked by a specific user.
         * Shows private playlists only if the requester is the creator.
         */
        get: `
            SELECT
                p.*,
                (
                    SELECT COUNT(*)::int
                    FROM "PlaylistItem" pi
                    WHERE pi."playlistId" = p.id
                ) AS "songCount",
                (
                    SELECT json_build_object('id', u.id, 'username', u.username, 'avatar', u.avatar)
                    FROM "User" u
                    WHERE u.id = p."creatorId"
                ) AS "creator"
            FROM "Interaction" i
            JOIN "Playlist" p ON i."targetId" = p.id
            WHERE i."userId" = $1 
              AND i."targetType" = 'playlist' 
              AND i."isLiked" = true
              AND (p."isPrivate" = false OR p."creatorId" = $2)
            ORDER BY i."interactedAt" DESC
            LIMIT $3 OFFSET $4;
        `,
        add: `
            INSERT INTO "Interaction" ("userId", "targetId", "targetType", "isLiked", "updatedAt")
            VALUES ($1, $2, 'playlist', true, NOW())
            ON CONFLICT ("userId", "targetId", "targetType") DO UPDATE
            SET "isLiked" = true, "updatedAt" = NOW()
            RETURNING "targetId" AS "playlistId", "isLiked";
        `,
        remove: `
            WITH target_interaction AS (
                SELECT i.id, i.rating,
                       EXISTS (SELECT 1 FROM "Comment" c WHERE c."interactionId" = i.id) AS has_comment
                FROM "Interaction" i
                WHERE i."userId" = $1 AND i."targetId" = $2 AND i."targetType" = 'playlist'
            ),
            deleted AS (
                DELETE FROM "Interaction" i
                USING target_interaction ti
                WHERE i.id = ti.id
                  AND ti.rating IS NULL
                  AND NOT ti.has_comment
                RETURNING i."targetId" AS "playlistId", false AS "isLiked"
            ),
            updated AS (
                UPDATE "Interaction" i
                SET "isLiked" = false, "updatedAt" = NOW()
                FROM target_interaction ti
                WHERE i.id = ti.id
                  AND (ti.rating IS NOT NULL OR ti.has_comment)
                RETURNING i."targetId" AS "playlistId", false AS "isLiked"
            )
            SELECT * FROM deleted
            UNION ALL
            SELECT * FROM updated;
        `,
    },
    getById: `
        SELECT 
            p.*,
            (
                SELECT COUNT(*)::int
                FROM "PlaylistItem" pi
                WHERE pi."playlistId" = p.id
            ) AS "songCount",
            (
                SELECT json_build_object('id', u.id, 'username', u.username, 'fullname', u.fullname, 'avatar', u.avatar)
                FROM "User" u
                WHERE u.id = p."creatorId"
            ) AS "creator",
            COALESCE(
                (
                    SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'fullname', u.fullname, 'avatar', u.avatar))
                    FROM "PlaylistOwner" po
                    JOIN "User" u ON u.id = po."userId"
                    WHERE po."playlistId" = p.id
                ),
                '[]'::json
            ) AS "owners",
            EXISTS (
                SELECT 1 FROM "Bookmark" b
                WHERE $2::uuid IS NOT NULL AND b."userId" = $2::uuid AND b."targetId" = p.id AND b."targetType" = 'playlist'
            ) AS "isSaved",
            (
                SELECT COUNT(*)::int FROM "Bookmark" b
                WHERE b."targetId" = p.id AND b."targetType" = 'playlist'
            ) AS "savesCount",
            EXISTS (
                SELECT 1 FROM "Interaction" i
                WHERE $2::uuid IS NOT NULL AND i."userId" = $2::uuid AND i."targetId" = p.id AND i."targetType" = 'playlist' AND i."isLiked" = true
            ) AS "isLiked",
            (
                SELECT COUNT(*)::int FROM "Interaction" i
                WHERE i."targetId" = p.id AND i."targetType" = 'playlist' AND i."isLiked" = true
            ) AS "likesCount",
            user_int.user_interaction AS "currentUserInteraction"
        FROM "Playlist" p
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
            WHERE $2::uuid IS NOT NULL AND cu_int."userId" = $2::uuid AND cu_int."targetId" = p.id AND cu_int."targetType" = 'playlist'
        ) user_int ON true
        WHERE p.id = $1::uuid
          AND (
              p."isPrivate" = false 
              OR ($2::uuid IS NOT NULL AND (
                  p."creatorId" = $2::uuid 
                  OR EXISTS (
                      SELECT 1 FROM "PlaylistOwner" po 
                      WHERE po."playlistId" = p.id AND po."userId" = $2::uuid
                  )
              ))
          );
    `,
    items: {
        /**
         * Checks whether a playlist exists and if the user has permission to access it.
         */
        checkAccess: `
            SELECT 
                p.id,
                p."isPrivate",
                p."creatorId",
                (
                    p."isPrivate" = false
                    OR ($2::uuid IS NOT NULL AND (
                        p."creatorId" = $2::uuid
                        OR EXISTS (
                            SELECT 1 FROM "PlaylistOwner" po
                            WHERE po."playlistId" = p.id AND po."userId" = $2::uuid
                        )
                    ))
                ) AS "hasAccess"
            FROM "Playlist" p
            WHERE p.id = $1::uuid;
        `,
        /**
         * Fetches all user interactions containing a comment for a specific playlist.
         */
        /**
         * $1 = targetId (playlist), $2 = limit, $3 = offset, $4 = currentUserId (nullable)
         */
        getInteractions: `
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
              AND i."targetType" = 'playlist'
              AND c."parentId" IS NULL
            ORDER BY c."createdAt" DESC
            LIMIT $2 OFFSET $3;
        `,
        /**
         * Fetches tracks inside a playlist.
         */
        getTracks: `
            SELECT 
                t."id", 
                t."spotifyId", 
                t."title", 
                t."duration", 
                t."image", 
                t."albumId", 
                t."createdAt",
                pli."addedAt",
                pli."addedBy",
                COALESCE(
                    i_like."isLiked",
                    false
                ) AS "isLiked",
                COALESCE(
                    (
                        SELECT json_agg(json_build_object('id', a."id", 'name', a."name"))
                        FROM "TrackArtist" ta
                        JOIN "Artist" a ON ta."artistId" = a."id"
                        WHERE ta."trackId" = t."id"
                    ), 
                    '[]'::json
                ) AS "artists"
            FROM "PlaylistItem" pli
            JOIN "Track" t ON pli."trackId" = t.id
            LEFT JOIN "Interaction" i_like ON i_like."userId" = $2::uuid AND i_like."targetId" = t.id AND i_like."targetType" = 'track' AND i_like."isLiked" = true
            WHERE pli."playlistId" = $1::uuid
            ORDER BY pli."addedAt" DESC
            LIMIT $3 OFFSET $4;
        `,
        /**
         * Inserts a new record into the PlaylistItem table to add a track to a specific playlist.
         * Returns the newly created row.
         */
        addTrack: `
            INSERT INTO "PlaylistItem" ("playlistId", "trackId", "addedBy")
            SELECT $1, $2, $3
            FROM "Playlist" p
            WHERE p.id = $1 
            AND (
                p."creatorId" = $3 
                OR EXISTS (
                    SELECT 1 FROM "PlaylistOwner" po 
                    WHERE po."playlistId" = p.id AND po."userId" = $3
                )
            )
            ON CONFLICT ("playlistId", "trackId") DO NOTHING
            RETURNING "playlistId", "trackId", "addedBy", "addedAt";
        `,
        /**
         * Removes a track from a custom playlist, ensuring that only the playlist creator or an owner can perform this action.
         */
        removeTrack: `
            DELETE FROM "PlaylistItem"
            WHERE "playlistId" = $1 
              AND "trackId" = $2
              AND EXISTS (
                  SELECT 1 FROM "Playlist" p
                  WHERE p.id = $1 AND (
                      p."creatorId" = $3 
                      OR EXISTS (
                          SELECT 1 FROM "PlaylistOwner" po 
                          WHERE po."playlistId" = p.id AND po."userId" = $3
                      )
                  )
              )
            RETURNING *;
        `,
    },
    interaction: {
        upsert: `
            INSERT INTO "Interaction" ("userId", "targetId", "targetType", "rating", "isLiked", "updatedAt")
            VALUES ($1, $2, 'playlist', $3, COALESCE($4, false), NOW())
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

