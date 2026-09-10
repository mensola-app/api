export const movieQueries = {
    /* ==========================================================================
       Custom Movie Lists & List Interactions
       ========================================================================== */
    lists: {
        /**
         * Fetches custom movie lists created by a specific user with top 3 preview movies
         * and user's movie interaction details (rating, like status, review existence).
         */
        getUserLists: `
            SELECT
                ml.id AS "listId",
                ml.title AS "listTitle",
                ml.image AS "image",
                (
                    SELECT COUNT(*)::int
                    FROM "MovieListItem" mli_cnt
                    WHERE mli_cnt."movieListId" = ml.id
                ) AS "movieCount",
                EXISTS (
                    SELECT 1 FROM "MovieListItem" mli
                    WHERE mli."movieListId" = ml.id AND ($5::uuid IS NOT NULL AND mli."movieId" = $5::uuid)
                ) AS "containsMovie",
                COALESCE(
                    (
                        SELECT json_agg(movie_posters.poster)
                        FROM (
                            SELECT m.poster
                            FROM "MovieListItem" mli_prev
                            JOIN "Movie" m ON mli_prev."movieId" = m.id
                            WHERE mli_prev."movieListId" = ml.id AND m.poster IS NOT NULL
                            ORDER BY mli_prev."addedAt" DESC
                            LIMIT 4
                        ) movie_posters
                    ),
                    '[]'::json
                ) AS "previewImages"
            FROM "MovieList" ml
            WHERE ml."creatorId" = $1 
                AND ml."listType" = 'custom' 
                AND (ml."isPrivate" = false OR $1 = $2)
            ORDER BY ml."updatedAt" DESC
            LIMIT $3 OFFSET $4;`,

        /**
         * Fetches a specific custom movie list by its ID, including list metadata,
         * top 3 preview movies, list owners, and up to 3 recent top-level comments.
         */
        getById: `
            SELECT 
                ml.*,
                COALESCE(list_owners.owners, '[]'::json) AS "owners",
                user_int.user_interaction AS "currentUserInteraction",
                EXISTS (
                    SELECT 1 FROM "Bookmark" b
                    WHERE $2::uuid IS NOT NULL AND b."userId" = $2::uuid AND b."targetId" = ml.id AND b."targetType" = 'movieList'
                ) AS "isSaved",
                (
                    SELECT COUNT(*)::int FROM "Bookmark" b
                    WHERE b."targetId" = ml.id AND b."targetType" = 'movieList'
                ) AS "savesCount",
                EXISTS (
                    SELECT 1 FROM "Interaction" i
                    WHERE $2::uuid IS NOT NULL AND i."userId" = $2::uuid AND i."targetId" = ml.id AND i."targetType" = 'movieList' AND i."isLiked" = true
                ) AS "isLiked",
                (
                    SELECT COUNT(*)::int FROM "Interaction" i
                    WHERE i."targetId" = ml.id AND i."targetType" = 'movieList' AND i."isLiked" = true
                ) AS "likesCount"
            FROM "MovieList" ml

            LEFT JOIN LATERAL (
                SELECT json_agg(ml_owners) AS owners
                FROM (
                    SELECT 
                        u.id AS "id",
                        u.username AS "username",
                        u.fullname AS "fullname",
                        u.avatar AS "avatar",
                        EXISTS (
                            SELECT 1 FROM "Follow" f1 
                            WHERE $2::uuid IS NOT NULL AND f1."followerId" = $2::uuid AND f1."followingId" = u.id AND f1."status" = 'accepted'
                        ) AS "isFollowing",
                        EXISTS (
                            SELECT 1 FROM "Follow" f_p 
                            WHERE $2::uuid IS NOT NULL AND f_p."followerId" = $2::uuid AND f_p."followingId" = u.id AND f_p."status" = 'pending'
                        ) AS "isPending",
                        EXISTS (
                            SELECT 1 FROM "Follow" f2 
                            WHERE $2::uuid IS NOT NULL AND f2."followerId" = u.id AND f2."followingId" = $2::uuid AND f2."status" = 'accepted'
                        ) AS "isFollower"
                    FROM "MovieListOwner" mlo
                    JOIN "User" u ON u.id = mlo."userId"
                    WHERE mlo."movieListId" = ml.id
                ) ml_owners
            ) list_owners ON true

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
                WHERE cu_int."userId" = $2::uuid AND cu_int."targetId" = ml.id AND cu_int."targetType" = 'movieList'
            ) user_int ON true

            WHERE ml.id = $1 
                AND ml."listType" = 'custom'
                AND (
                    ml."isPrivate" = false 
                    OR ($2::uuid IS NOT NULL AND (
                        ml."creatorId" = $2 
                        OR EXISTS (
                            SELECT 1 FROM "MovieListOwner" mlo 
                            WHERE mlo."movieListId" = ml.id AND mlo."userId" = $2
                        )
                    ))
                );`,

        /**
         * Checks whether a movie list exists and if the user has permission to access it.
         */
        checkAccess: `
            SELECT 
                ml.id,
                ml."isPrivate",
                ml."creatorId",
                (
                    ml."isPrivate" = false
                    OR ($2::uuid IS NOT NULL AND (
                        ml."creatorId" = $2::uuid
                        OR EXISTS (
                            SELECT 1 FROM "MovieListOwner" mlo
                            WHERE mlo."movieListId" = ml.id AND mlo."userId" = $2::uuid
                        )
                    ))
                ) AS "hasAccess"
            FROM "MovieList" ml
            WHERE ml.id = $1::uuid;
        `,

        /**
         * Inserts a new custom movie list into the database and returns created record.
         */
        create: `
            INSERT INTO "MovieList" (id, title, description, image, "isPrivate","creatorId", "createdAt", "updatedAt") 
            VALUES (gen_random_uuid(), $1, $2, $3, COALESCE($4, false), $5, NOW(), NOW()) 
            RETURNING id, title, description, image, "isPrivate","creatorId", "createdAt", "updatedAt";`,

        /**
         * Updates an existing custom movie list, allowing for modification of its title, description, image, and privacy status.
         * Returns the updated record.
         */
        update: `
            UPDATE "MovieList" ml
            SET 
                title = COALESCE($1, ml.title),
                description = CASE WHEN $8::boolean = true THEN $2 ELSE ml.description END,
                image = CASE WHEN $7::boolean = true THEN $3 ELSE ml.image END,
                "isPrivate" = COALESCE($4, ml."isPrivate"),
                "updatedAt" = NOW()
            WHERE ml.id = $5 
              AND ml."listType" = 'custom'
              AND (
                  ml."creatorId" = $6 
                  OR EXISTS (
                      SELECT 1 FROM "MovieListOwner" mlo 
                      WHERE mlo."movieListId" = ml.id AND mlo."userId" = $6
                  )
              )
            RETURNING ml.*;`,

        /**
         * Completely removes a custom movie list by deleting the associated record
         * in the MovieList table, ensuring that only the list creator or an owner can perform this action.
         */
        delete: `
            DELETE FROM "MovieList" ml
            WHERE ml.id = $1 
              AND ml."listType" = 'custom'
              AND ml."creatorId" = $2
            RETURNING *;`,

        items: {
            /**
             * Fetches all movies contained in a specific custom movie list, including
             * user's interaction details (rating, like status, review existence).
             */
            getMovies: `
                SELECT
                    m.id,
                    m.title,
                    m.poster,
                    m_int.rating,
                    COALESCE(m_int."isLiked", false) AS "isLiked",
                    EXISTS (
                        SELECT 1 FROM "Comment" c WHERE c."interactionId" = m_int.id
                    ) AS "hasReview"
                FROM "MovieList" ml
                JOIN "MovieListItem" mli ON ml.id = mli."movieListId"
                JOIN "Movie" m ON mli."movieId" = m.id
                LEFT JOIN "Interaction" m_int ON m_int."userId" = $2::uuid AND m_int."targetId" = m.id AND m_int."targetType" = 'movie'
                WHERE ml.id = $1
                    AND ml."listType" = 'custom'
                    AND (
                        ml."isPrivate" = false 
                        OR ($2::uuid IS NOT NULL AND (
                            ml."creatorId" = $2 
                            OR EXISTS (
                                SELECT 1 FROM "MovieListOwner" mlo 
                                WHERE mlo."movieListId" = ml.id AND mlo."userId" = $2
                            )
                        ))
                    )
                LIMIT $3 OFFSET $4;`,

            /**
             * Fetches all user interactions containing a comment for a specific movie list.
             */
            /**
             * $1 = targetId (movieList), $2 = limit, $3 = offset, $4 = currentUserId (nullable)
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
                  AND i."targetType" = 'movieList'
                  AND c."parentId" IS NULL
                ORDER BY c."createdAt" DESC
                LIMIT $2 OFFSET $3;`,

            /**
             * Inserts a new record into the MovieListItem table to add a movie to a specific custom movie list.
             * Returns the newly created row.
             */
            addMovie: `
                INSERT INTO "MovieListItem" ("movieListId", "movieId", "addedBy")
                SELECT $1, $2, $3
                FROM "MovieList" ml
                WHERE ml.id = $1 
                AND (
                    ml."creatorId" = $3 
                    OR EXISTS (
                        SELECT 1 FROM "MovieListOwner" mlo 
                        WHERE mlo."movieListId" = ml.id AND mlo."userId" = $3
                    )
                )
                ON CONFLICT ("movieListId", "movieId") DO NOTHING
                RETURNING "movieListId", "movieId", "addedBy", "addedAt";`,

            /**
             * Completely removes a movie from a specific custom movie list by deleting the associated record
             * in the MovieListItem table, ensuring that only the list creator or an owner can perform this action.
             */
            removeMovie: `
                DELETE FROM "MovieListItem"
                WHERE "movieListId" = $1 
                  AND "movieId" = $2
                  AND EXISTS (
                      SELECT 1 FROM "MovieList" ml
                      WHERE ml.id = $1 AND (
                          ml."creatorId" = $3 
                          OR EXISTS (
                              SELECT 1 FROM "MovieListOwner" mlo 
                              WHERE mlo."movieListId" = ml.id AND mlo."userId" = $3
                          )
                      )
                  )
                RETURNING *;`,
        },

        likes: {
            /**
             * Fetches custom movie lists that a user has liked, including list metadata,
             * top 3 preview movies, and user's movie interaction states.
             */
            get: `
                SELECT
                    ml.id AS "listId",
                    ml.title AS "listTitle",
                    ml.image AS "image",
                    (
                        SELECT COUNT(*)::int
                        FROM "MovieListItem" mli_cnt
                        WHERE mli_cnt."movieListId" = ml.id
                    ) AS "movieCount",
                    (
                        SELECT json_build_object('id', u.id, 'username', u.username, 'avatar', u.avatar)
                        FROM "User" u
                        WHERE u.id = ml."creatorId"
                    ) AS "creator",
                    COALESCE(
                        (
                            SELECT json_agg(movie_posters.poster)
                            FROM (
                                SELECT m.poster
                                FROM "MovieListItem" mli_prev
                                JOIN "Movie" m ON mli_prev."movieId" = m.id
                                WHERE mli_prev."movieListId" = ml.id AND m.poster IS NOT NULL
                                ORDER BY mli_prev."addedAt" DESC
                                LIMIT 4
                            ) movie_posters
                        ),
                        '[]'::json
                    ) AS "previewImages"
                FROM "Interaction" ml_int
                JOIN "MovieList" ml ON ml.id = ml_int."targetId"
                WHERE ml_int."targetType" = 'movieList' 
                    AND ml_int."userId" = $1 
                    AND ml_int."isLiked" = true
                    AND (ml."isPrivate" = false OR ml."creatorId" = $2)
                ORDER BY ml_int."updatedAt" DESC
                LIMIT $3 OFFSET $4;`,

            /**
             * Inserts a new record into the Interaction table to mark a custom movie list as liked by the user.
             * If the user has already liked the list, it updates the existing record to ensure isLiked is true.
             */
            add: `
                INSERT INTO "Interaction" ("userId", "targetId", "targetType", "isLiked")
                SELECT $1, ml.id, 'movieList', true
                FROM "MovieList" ml
                WHERE ml.id = $2
                    AND (ml."isPrivate" = false OR ml."creatorId" = $1)
                    ON CONFLICT ("userId", "targetId", "targetType") 
                DO UPDATE SET "isLiked" = true
                RETURNING "targetId" AS "listId", "isLiked";`,

            /**
             * Updates the Interaction table to mark a custom movie list as unliked by the user.
             * If the user has not liked the list before, it does nothing.
             */
            remove: `
                UPDATE "Interaction"
                SET "isLiked" = false
                WHERE "userId" = $1 AND "targetId" = $2 AND "targetType" = 'movieList'
                RETURNING "targetId" AS "listId", "isLiked";`,
        },
    },

    /* ==========================================================================
       Movie Library & User Interactions
       ========================================================================== */
    movies: {
        /**
         * Fetches all details of a specific movie by its ID, including up to 3 recent
         * top-level user interactions that have a comment.
         */
        getById: `
            SELECT 
                m.*,
                EXISTS (SELECT 1 FROM "WatchedMovie" wm WHERE wm."movieId" = m.id AND wm."userId" = $2::uuid) AS "isWatched",
                EXISTS (
                    SELECT 1 FROM "MovieListItem" mli
                    JOIN "MovieList" ml ON ml.id = mli."movieListId"
                    WHERE mli."movieId" = m.id AND ml."creatorId" = $2::uuid
                ) AS "isInList",
                EXISTS (
                    SELECT 1 FROM "MovieListItem" mli
                    JOIN "MovieList" ml ON ml.id = mli."movieListId"
                    WHERE mli."movieId" = m.id AND ml."creatorId" = $2::uuid AND ml."listType" = 'watchlist'
                ) AS "isWatchlisted",
                EXISTS (
                    SELECT 1 FROM "MovieListItem" mli
                    JOIN "MovieList" ml ON ml.id = mli."movieListId"
                    WHERE mli."movieId" = m.id AND ml."creatorId" = $2::uuid AND ml."listType" = 'favorites'
                ) AS "isFavorite",
                (SELECT COUNT(*)::int FROM "Interaction" i WHERE i."targetId" = m.id AND i."targetType" = 'movie' AND i."isLiked" = true) AS "likesCount",
                (SELECT COUNT(*)::int FROM "Comment" c JOIN "Interaction" i ON c."interactionId" = i.id WHERE i."targetId" = m.id AND i."targetType" = 'movie') AS "commentsCount",
                COALESCE(interactions_data.interactions, '[]') AS interactions,
                user_int.user_interaction AS "currentUserInteraction"
            FROM "Movie" m
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
                        m_int.id, 
                        m_int."rating", 
                        m_int."isLiked",
                        c.id AS cid, 
                        c.content, 
                        c."createdAt",
                        u.id AS uid, 
                        u.username, 
                        u.fullname, 
                        u.avatar,
                        (SELECT COUNT(*)::int FROM "CommentLike" cl WHERE cl."commentId" = c.id) AS "likesCount",
                        (SELECT COUNT(*)::int FROM "Comment" sub_c WHERE sub_c."interactionId" = m_int.id AND sub_c."parentId" IS NOT NULL) AS "replyCount",
                        CASE
                            WHEN $2::uuid IS NOT NULL
                            THEN EXISTS (SELECT 1 FROM "CommentLike" cl WHERE cl."commentId" = c.id AND cl."userId" = $2::uuid)
                            ELSE false
                        END AS "isLikedByMe"
                    FROM "Interaction" m_int
                    JOIN "Comment" c ON c."interactionId" = m_int.id AND c."parentId" IS NULL
                    LEFT JOIN "User" u ON u.id = m_int."userId"
                    WHERE m_int."targetId" = m.id AND m_int."targetType" = 'movie'
                    ORDER BY c."createdAt" DESC
                    LIMIT 3
                ) int_data
            ) interactions_data ON true

            LEFT JOIN LATERAL (
                SELECT json_build_object(
                    'id', cu_int.id,
                    'rating', cu_int."rating",
                    'isLiked', COALESCE(cu_int."isLiked", false),
                    'comment', (
                        SELECT json_build_object(
                            'id', c.id,
                            'content', c.content,
                            'date', c."createdAt"
                        )
                        FROM "Comment" c
                        WHERE c."interactionId" = cu_int.id AND c."parentId" IS NULL
                        LIMIT 1
                    )
                ) AS user_interaction
                FROM "Interaction" cu_int
                WHERE cu_int."targetId" = m.id
                    AND cu_int."targetType" = 'movie'
                    AND cu_int."userId" = $2::uuid
            ) user_int ON ($2::uuid IS NOT NULL)
                           
            WHERE m.id = $1;`,

        checkExists: `
            SELECT * 
            FROM "Movie" m 
            WHERE m."tmdbId" = $1`,

        insertMovie: `
            INSERT INTO "Movie" ("tmdbId", title, poster, "releaseDate", rating, genres, duration, overview, "createdAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING id;`,

        /**
         * Watchlist management (System MovieList where listType = 'watchlist')
         */
        watchlist: {
            /**
             * Retrieves a paginated list of movies from the user's system Watchlist.
             */
            get: `
                SELECT
                    m.id,
                    m.title,
                    m.poster
                FROM "MovieList" ml
                JOIN "MovieListItem" mli ON ml.id = mli."movieListId"
                JOIN "Movie" m ON mli."movieId" = m.id
                WHERE ml."listType" = 'watchlist' AND ml."creatorId" = $1
                LIMIT $2 OFFSET $3;`,

            /**
             * Inserts a new record into the MovieListItem table to add a movie to the user's watchlist.
             * Returns the newly created row.
             */
            add: `
                WITH existing_list AS (
                    SELECT id FROM "MovieList" WHERE "listType" = 'watchlist' AND "creatorId" = $1 LIMIT 1
                ),
                new_list AS (
                    INSERT INTO "MovieList" ("title", "isPrivate", "listType", "creatorId")
                    SELECT 'Watchlist', true, 'watchlist', $1
                    WHERE NOT EXISTS (SELECT 1 FROM existing_list)
                    RETURNING id
                ),
                target_list AS (
                    SELECT id FROM existing_list UNION ALL SELECT id FROM new_list
                )
                INSERT INTO "MovieListItem" ("movieListId", "movieId", "addedBy", "addedAt")
                SELECT id, $2, $1, NOW() FROM target_list
                ON CONFLICT ("movieListId", "movieId") DO NOTHING
                RETURNING *;`,

            /**
             * Completely removes a movie from the user's watchlist by deleting all associated records
             * for that specific movie in the MovieListItem table.
             */
            remove: `
                DELETE FROM "MovieListItem"
                WHERE "movieListId" IN (SELECT id FROM "MovieList" WHERE "listType" = 'watchlist' AND "creatorId" = $1) AND "movieId" = $2
                RETURNING *;`,
        },

        /**
         * Watched movies history
         */
        watched: {
            /**
             * Retrieves a paginated list of movies the user has watched, along with
             * watched date, rating, like status, and review existence.
             */
            get: `
                SELECT
                    m.id,
                    m.title,
                    m.poster,
                    m_int.rating,
                    COALESCE(m_int."isLiked", false) AS "isLiked",
                    MAX(wm."watchedAt") AS "watchedAt",
                    COUNT(wm.id)::int AS "watchCount",
                    EXISTS (
                        SELECT 1 FROM "Comment" c WHERE c."interactionId" = m_int.id
                    ) AS "hasReview"
                FROM "WatchedMovie" wm
                JOIN "Movie" m ON wm."movieId" = m.id
                LEFT JOIN "Interaction" m_int ON m_int."userId" = wm."userId"
                    AND m_int."targetId" = m.id
                    AND m_int."targetType" = 'movie'
                WHERE wm."userId" = $1
                GROUP BY m.id, m_int.rating, m_int."isLiked", m_int.id
                ORDER BY "watchedAt" DESC
                LIMIT $2 OFFSET $3;`,

            /**
             * Inserts a new record into the WatchedMovie table to mark a movie as watched
             * and returns the newly created row.
             */
            add: `
                INSERT INTO "WatchedMovie" (id, "userId", "movieId", "watchedAt")
                VALUES (gen_random_uuid(), $1, $2, COALESCE($3::TIMESTAMPTZ, NOW()))
                RETURNING *`,

            /**
             * Updates the watchedAt timestamp of a specific WatchedMovie record by its ID.
             * Only the owner can update their own record.
             */
            updateWatchedAt: `
                UPDATE "WatchedMovie"
                SET "watchedAt" = $3::TIMESTAMPTZ
                WHERE id = $1 AND "userId" = $2
                RETURNING *;`,

            /**
             * Deletes a specific WatchedMovie record by its ID.
             * Only the owner can delete their own record.
             */
            deleteById: `
                DELETE FROM "WatchedMovie"
                WHERE id = $1 AND "userId" = $2
                RETURNING *;`,

            /**
             * Retrieves all WatchedMovie records for a specific user and movie,
             * ordered by watchedAt descending.
             */
            getByMovieId: `
                SELECT id, "userId", "movieId", "watchedAt", "createdAt"
                FROM "WatchedMovie"
                WHERE "userId" = $1 AND "movieId" = $2
                ORDER BY "watchedAt" DESC;`,

            /**
             * Completely removes a movie from the user's watched history by deleting
             * all associated watch records for that specific movie.
             */
            remove: `
                DELETE FROM "WatchedMovie"
                WHERE "userId" = $1 AND "movieId" = $2
                RETURNING *;`,
        },

        /**
         * Favorite movies (System MovieList where listType = 'favorites')
         */
        favorites: {
            /**
             * Retrieves a paginated list of user's favorite movies from their system Favorites list.
             */
            get: `
                SELECT
                    m.id,
                    m.title,
                    m.poster,
                    m_int.rating,
                    COALESCE(m_int."isLiked", false) AS "isLiked",
                    mli."addedAt" AS added_at,
                    EXISTS (
                        SELECT 1 FROM "Comment" c WHERE c."interactionId" = m_int.id
                    ) AS "hasReview"
                FROM "MovieList" ml
                JOIN "MovieListItem" mli ON ml.id = mli."movieListId"
                JOIN "Movie" m ON mli."movieId" = m.id
                LEFT JOIN "Interaction" m_int ON m_int."userId" = ml."creatorId" AND m_int."targetId" = m.id
                WHERE ml."listType" = 'favorites' AND ml."creatorId" = $1
                LIMIT $2 OFFSET $3;`,

            /**
             * Inserts a new record into the MovieListItem table to add a movie to the user's favorites list.
             * Returns the newly created row.
             */
            add: `
                WITH existing_list AS (
                    SELECT id FROM "MovieList" WHERE "listType" = 'favorites' AND "creatorId" = $1 LIMIT 1
                ),
                new_list AS (
                    INSERT INTO "MovieList" ("title", "isPrivate", "listType", "creatorId")
                    SELECT 'Favorites', true, 'favorites', $1
                    WHERE NOT EXISTS (SELECT 1 FROM existing_list)
                    RETURNING id
                ),
                target_list AS (
                    SELECT id FROM existing_list UNION ALL SELECT id FROM new_list
                )
                INSERT INTO "MovieListItem" ("movieListId", "movieId", "addedBy", "addedAt")
                SELECT id, $2, $1, NOW() FROM target_list
                ON CONFLICT ("movieListId", "movieId") DO NOTHING
                RETURNING *;`,

            /**
             * Completely removes a movie from the user's favorites list by deleting all associated records
             * for that specific movie in the MovieListItem table.
             */
            remove: `
                DELETE FROM "MovieListItem"
                WHERE "movieListId" IN (SELECT id FROM "MovieList" WHERE "listType" = 'favorites' AND "creatorId" = $1) AND "movieId" = $2
                RETURNING *;`,
        },

        /**
         * Liked movies (Interaction table where targetType = 'movie' and isLiked = true)
         */
        likes: {
            /**
             * Retrieves a paginated list of movies the user has liked via Interaction records.
             */
            get: `
                SELECT 
                    m.id,
                    m.title,
                    m.poster,
                    m_int.rating,
                    true AS "isLiked",
                    EXISTS (
                        SELECT 1 FROM "Comment" c WHERE c."interactionId" = m_int.id
                    ) AS "hasReview"
                FROM "Interaction" m_int
                JOIN "Movie" m ON m.id = m_int."targetId"
                WHERE m_int."userId" = $1 AND m_int."targetType" = 'movie' AND m_int."isLiked" = true
                LIMIT $2 OFFSET $3;`,

            /**
             * Inserts a new record into the Interaction table to mark a movie as liked by the user.
             * If the user has already liked the movie, it updates the existing record to ensure isLiked is true.
             */
            add: `
                INSERT INTO "Interaction" ("userId", "targetId", "targetType", "isLiked")
                VALUES ($1, $2, 'movie', true)
                ON CONFLICT ("userId", "targetId", "targetType") DO UPDATE SET "isLiked" = true
                RETURNING "targetId" AS "movieId", "isLiked";`,

            /**
             * Removes a movie from the user's liked movies.
             * If the interaction has no rating or comments, the interaction row is deleted.
             * If it has a rating or comments, isLiked is set to false to preserve the interaction.
             */
            remove: `
                WITH target_interaction AS (
                    SELECT i.id, i.rating,
                           EXISTS (SELECT 1 FROM "Comment" c WHERE c."interactionId" = i.id) AS has_comment
                    FROM "Interaction" i
                    WHERE i."userId" = $1 AND i."targetId" = $2 AND i."targetType" = 'movie'
                ),
                deleted AS (
                    DELETE FROM "Interaction" i
                    USING target_interaction ti
                    WHERE i.id = ti.id
                      AND ti.rating IS NULL
                      AND NOT ti.has_comment
                    RETURNING i."targetId" AS "movieId", false AS "isLiked"
                ),
                updated AS (
                    UPDATE "Interaction" i
                    SET "isLiked" = false
                    FROM target_interaction ti
                    WHERE i.id = ti.id
                      AND (ti.rating IS NOT NULL OR ti.has_comment)
                    RETURNING i."targetId" AS "movieId", i."isLiked"
                )
                SELECT * FROM deleted
                UNION ALL
                SELECT * FROM updated;`,
        },

        /**
         * Full movie interaction (rating, comment, isLiked)
         */
        interaction: {
            upsert: `
                INSERT INTO "Interaction" ("id", "userId", "targetId", "targetType", "rating", "isLiked", "interactedAt", "updatedAt")
                VALUES (gen_random_uuid(), $1, $2, $5, $3, COALESCE($4, false), NOW(), NOW())
                ON CONFLICT ("userId", "targetId", "targetType")
                DO UPDATE SET
                    "rating" = EXCLUDED."rating",
                    "isLiked" = EXCLUDED."isLiked",
                    "updatedAt" = NOW()
                RETURNING "id", "userId", "targetId", "targetType", "rating", "isLiked";`,

            /**
             * Inserts or updates a top-level review/comment for an interaction.
             */
            upsertComment: `
                WITH existing AS (
                    SELECT id FROM "Comment" WHERE "interactionId" = $1 AND "parentId" IS NULL
                ),
                updated AS (
                    UPDATE "Comment"
                    SET "content" = $2
                    WHERE "interactionId" = $1 AND "parentId" IS NULL
                    RETURNING id, "userId", "interactionId", "content", "createdAt"
                )
                INSERT INTO "Comment" (id, "userId", "interactionId", "content", "createdAt")
                SELECT gen_random_uuid(), $3, $1, $2, NOW()
                WHERE NOT EXISTS (SELECT 1 FROM existing)
                UNION ALL
                SELECT id, "userId", "interactionId", "content", "createdAt" FROM updated;`,

            /**
             * Deletes top-level review/comment for an interaction.
             */
            deleteComment: `
                DELETE FROM "Comment"
                WHERE "interactionId" = $1 AND "parentId" IS NULL;`,

            /**
             * Cleans up empty interaction records.
             */
            cleanupEmpty: `
                DELETE FROM "Interaction"
                WHERE id = $1
                  AND "rating" IS NULL
                  AND "isLiked" = false
                  AND NOT EXISTS (SELECT 1 FROM "Comment" WHERE "interactionId" = $1);`,
        },

        /**
         * $1 = targetId (movie), $2 = limit, $3 = offset, $4 = currentUserId (nullable)
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
              AND i."targetType" = 'movie'
              AND c."parentId" IS NULL
            ORDER BY c."createdAt" DESC
            LIMIT $2 OFFSET $3;`,
    },
};
