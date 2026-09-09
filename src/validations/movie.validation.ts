import { z } from "zod";
import { createOrUpdateInteractionBody, limitQueryRule, pageQueryRule, userIdRule } from "./common.validation";
import { MESSAGES } from "../constants/messages/tr";

/* ==========================================================================
   Shared & Query Validations
   ========================================================================== */

export const movieIdRule = z
    .string({ message: MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.MOVIE_ID) })
    .uuid(MESSAGES.ERRORS.INVALID_UUID(MESSAGES.FIELDS.MOVIE_ID))
    .trim();
export const listIdRule = z.string().uuid(MESSAGES.ERRORS.INVALID_UUID(MESSAGES.FIELDS.LIST_ID)).trim();
export const listTitleRule = z
    .string({ message: MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.TITLE) })
    .trim()
    .min(1, MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.TITLE))
    .max(100, MESSAGES.ERRORS.MAX_LENGTH(MESSAGES.FIELDS.TITLE, 100));
export const listDescRule = z
    .string()
    .trim()
    .max(500, MESSAGES.ERRORS.MAX_LENGTH(MESSAGES.FIELDS.DESCRIPTION, 500))
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));
export const listImageRule = z
    .union([
        z.string().url(MESSAGES.ERRORS.INVALID_URL),
        z.literal(""),
    ])
    .nullable()
    .optional()
    .transform((val) => (val === "" ? null : val));
export const listIsPrivateRule = z
    .boolean({ message: MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.IS_PRIVATE) })
    .optional();

/**
 * Validation schema for endpoints that require a valid `movieId` parameter.
 */
export const movieIdParamSchema = z.object({
    params: z.object({ movieId: movieIdRule }),
});

export const movieInteractionsParamSchema = z.object({
    params: z.object({
        movieId: z.string({ message: MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.MOVIE_ID) }).trim().min(1),
    }),
});

export const addFavoriteMovieSchema = z.object({
    body: z.object({
        movieId: movieIdRule.optional(),
        tmdbId: z.coerce.number().optional(),
        replaceMovieId: movieIdRule.optional(),
    }).refine(data => data.movieId !== undefined || data.tmdbId !== undefined, {
        message: "movieId veya tmdbId belirtilmelidir.",
        path: ["movieId"]
    })
});

export const tmdbIdParamSchema = z.object({
    params: z.object({ tmdbId: z.coerce.number() }),
});

/**
 * Validation schema for endpoints that require a valid `listId` parameter.
 */
export const listIdParamSchema = z.object({
    params: z.object({ listId: listIdRule }),
});

/**
 * Validation schema for endpoints that require both `listId` and `movieId` parameters.
 * Ideal for adding or removing a movie from a list.
 */
export const listAndMovieParamsSchema = z.object({
    params: z.object({ listId: listIdRule, movieId: movieIdRule }),
});

/**
 * Validation schema for paginated movie and list endpoints.
 * Validates optional `userId`, `page`, and `limit` query parameters.
 */
export const moviePaginationQuerySchema = z.object({
    query: z.object({ userId: userIdRule, page: pageQueryRule, limit: limitQueryRule }),
});

/* ==========================================================================
   Movie List Validations (Custom Lists)
   ========================================================================== */

/**
 * Validation schema for creating a new custom movie list.
 */
export const createMovieListSchema = z.object({
    body: z.object(
        {
            title: listTitleRule,
            description: listDescRule,
            image: listImageRule,
            isPrivate: listIsPrivateRule,
        },
        { message: MESSAGES.ERRORS.MISSING_REQUIRED_FIELDS },
    ),
});

/**
 * Validation schema for updating a custom movie list.
 */
export const updateMovieListSchema = z.object({
    params: listIdParamSchema.shape.params,
    body: z
        .object(
            {
                title: listTitleRule.optional(),
                description: listDescRule,
                image: listImageRule,
                isPrivate: listIsPrivateRule,
            },
            { message: MESSAGES.ERRORS.MISSING_REQUIRED_FIELDS },
        )
        .refine((data) => Object.keys(data).length > 0, MESSAGES.ERRORS.AT_LEAST_ONE_FIELD_REQUIRED),
});

/**
 * Validation schema for creating or updating a movie interaction (rating, comment, isLiked).
 */
export const createMovieInteractionSchema = z.object({
    params: z.object({ movieId: movieIdRule }),
    body: createOrUpdateInteractionBody,
});

/* ==========================================================================
   Watched Movie History Validations
   ========================================================================== */

/**
 * Validation schema for marking a movie as watched.
 * Accepts an optional watchedAt ISO date string in the body.
 */
export const markMovieAsWatchedSchema = z.object({
    params: z.object({ movieId: movieIdRule }),
    body: z.object({
        watchedAt: z.string().datetime({ offset: true }).optional().nullable(),
    }).optional(),
});

/**
 * Validation schema for endpoints that require a valid `watchedMovieId` param.
 */
export const watchedMovieIdParamSchema = z.object({
    params: z.object({
        watchedMovieId: z
            .string({ message: "watchedMovieId zorunludur." })
            .uuid("watchedMovieId geçerli bir UUID olmalıdır.")
            .trim(),
    }),
});

/**
 * Validation schema for PATCH /watched/:watchedMovieId.
 * Requires a valid watchedAt ISO timestamp in the body.
 */
export const updateWatchedAtSchema = z.object({
    params: z.object({
        watchedMovieId: z
            .string({ message: "watchedMovieId zorunludur." })
            .uuid("watchedMovieId geçerli bir UUID olmalıdır.")
            .trim(),
    }),
    body: z.object({
        watchedAt: z.string({ message: "watchedAt zorunludur." }).datetime({ offset: true }),
    }),
});

/**
 * Validation schema for GET /movies/:movieId/watched-history.
 */
export const watchedHistoryByMovieIdSchema = z.object({
    params: z.object({ movieId: movieIdRule }),
});
