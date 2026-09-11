import pool from "@/config/db";
import { movieQueries } from "@/queries/movie.queries";
import { ApiError } from "@/utils/error";
import { MovieId, TmdbId } from "@/types/common.types";
import { createNotification } from "./notification.service";

// Types & Interfaces
import {
    // Entity Models
    IMovieList,
    IWatchedMovie,
    IMovieListItem,

    // Data Transfer Objects (DTOs)
    CreateMovieListDto,
    GetFavoritesDto,
    GetLikedListsDto,
    GetLikedMoviesDto,
    GetUserListsDto,
    GetWatchedMoviesDto,
    GetWatchlistDto,
    UserMovieActionDto,
    GetMovieDto,
    UpdateWatchedAtDto,
    DeleteWatchedByIdDto,
    GetWatchedByMovieIdDto,

    // Response Contracts & Items
    GetFavoritesResponse,
    GetFavoritesResponseItem,
    GetLikedListsResponse,
    GetLikedListsResponseItem,
    GetLikedMoviesResponse,
    GetLikedMoviesResponseItem,
    GetUserListsResponse,
    GetUserListsResponseItem,
    GetWatchedMoviesResponse,
    GetWatchedMoviesResponseItem,
    GetWatchlistResponse,
    GetMovieResponse,
    UpdateMovieListDto,
    DeleteListDto,
    GetListByIdDto,
    GetListByIdResponse,
    GetListItemsResponse,
    GetListItemsDto,
    MovieSummary,
    MovieListItemDto,
    LikeMovieListDto,
    LikeMovieListResponse,
    UnlikeMovieListDto,
    UnlikeMovieListResponse,
    LikeMovieDto,
    LikeMovieResponse,
    UnlikeMovieDto,
    UnlikeMovieResponse,
    FindOrFetchFromTmdbDto,
} from "@/types/movie.types";
import { upsertInteractionComment } from "@/utils/interaction";
import { tmdbService } from "./tmdb.service";

/**
 * Retrieves a paginated list of favorite movies for a given user.
 *
 * @param dto - Data transfer object containing userId, page, and limit.
 * @returns Array of favorite movie items.
 * @throws {ApiError} 400 Bad Request if userId is missing.
 */
export const getFavorites = async (dto: GetFavoritesDto): Promise<GetFavoritesResponse> => {
    const offset = (dto.page - 1) * dto.limit;

    const result = await pool.query<GetFavoritesResponseItem>(movieQueries.movies.favorites.get, [
        dto.userId,
        dto.limit,
        offset,
    ]);

    return result.rows;
};

/**
 * Retrieves a paginated watchlist of movies for a given user.
 *
 * @param dto - Data transfer object containing userId, page, and limit.
 * @returns Array of watchlist movie items.
 * @throws {ApiError} 400 Bad Request if userId is missing.
 */
export const getWatchlist = async (dto: GetWatchlistDto): Promise<GetWatchlistResponse> => {
    const offset = (dto.page - 1) * dto.limit;

    const result = await pool.query<MovieSummary>(movieQueries.movies.watchlist.get, [dto.userId, dto.limit, offset]);

    return result.rows;
};

/**
 * Retrieves a paginated history of movies watched by a given user.
 *
 * @param dto - Data transfer object containing userId, page, and limit.
 * @returns Array of watched movie items with rating and review state.
 * @throws {ApiError} 400 Bad Request if userId is missing.
 */
export const getWatched = async (dto: GetWatchedMoviesDto): Promise<GetWatchedMoviesResponse> => {
    const offset = (dto.page - 1) * dto.limit;

    const result = await pool.query<GetWatchedMoviesResponseItem>(movieQueries.movies.watched.get, [
        dto.userId,
        dto.limit,
        offset,
    ]);

    return result.rows;
};

/**
 * Retrieves a paginated list of movies liked by a given user.
 *
 * @param dto - Data transfer object containing userId, page, and limit.
 * @returns Array of liked movie items.
 * @throws {ApiError} 400 Bad Request if userId is missing.
 */
export const getLikedMovies = async (dto: GetLikedMoviesDto): Promise<GetLikedMoviesResponse> => {
    const offset = (dto.page - 1) * dto.limit;

    const result = await pool.query<GetLikedMoviesResponseItem>(movieQueries.movies.likes.get, [
        dto.userId,
        dto.limit,
        offset,
    ]);

    return result.rows;
};

/**
 * Retrieves custom movie lists created by a specific user with top 3 preview movies.
 *
 * @param dto - Data transfer object containing userId, page, and limit.
 * @returns Array of custom movie lists with preview items.
 * @throws {ApiError} 400 Bad Request if userId is missing.
 */
export const getUserLists = async (dto: GetUserListsDto): Promise<GetUserListsResponse> => {
    const offset = (dto.page - 1) * dto.limit;

    const result = await pool.query<GetUserListsResponseItem>(movieQueries.lists.getUserLists, [
        dto.userId,
        dto.currentUserId || null,
        dto.limit,
        offset,
        dto.movieId || null,
    ]);

    return result.rows;
};

/**
 * Retrieves custom movie lists that a given user has liked.
 *
 * @param dto - Data transfer object containing userId, page, and limit.
 * @returns Array of liked movie lists with preview items.
 * @throws {ApiError} 400 Bad Request if userId is missing.
 */
export const getLikedLists = async (dto: GetLikedListsDto): Promise<GetLikedListsResponse> => {
    const offset = (dto.page - 1) * dto.limit;

    const result = await pool.query<GetLikedListsResponseItem>(movieQueries.lists.likes.get, [
        dto.userId,
        dto.currentUserId || null,
        dto.limit,
        offset,
    ]);

    return result.rows;
};

/**
 * Creates a new custom movie list for a user.
 *
 * @param dto - Data transfer object containing title, description, image, isPrivate, and creatorId.
 * @returns The newly created MovieList record.
 * @throws {ApiError} 500 Internal Server Error if list creation fails.
 */
export const createList = async (dto: CreateMovieListDto): Promise<IMovieList> => {
    const values = [dto.title, dto.description ?? null, dto.image ?? null, dto.isPrivate ?? null, dto.creatorId];
    const result = await pool.query<IMovieList>(movieQueries.lists.create, values);

    const movieList = result.rows[0];

    if (!movieList) {
        throw new ApiError("ACTION_FAILED_NO_PERMISSION", 500);
    }

    return movieList;
};

/**
 * Marks a movie as watched by adding a record to the WatchedMovie table.
 *
 * @param dto - Data transfer object containing userId, movieId, and optional watchedAt.
 * @returns The newly created WatchedMovie record.
 */
export const markAsWatched = async (dto: UserMovieActionDto & { watchedAt?: Date | string | null }): Promise<IWatchedMovie> => {
    const result = await pool.query<IWatchedMovie>(movieQueries.movies.watched.add, [
        dto.userId,
        dto.movieId,
        dto.watchedAt ?? null,
    ]);
    return result.rows[0];
};

/**
 * Updates the watchedAt timestamp of a specific WatchedMovie record by its ID.
 *
 * @param dto - Data transfer object containing watchedMovieId, userId, and new watchedAt date.
 * @returns The updated WatchedMovie record.
 * @throws {ApiError} 404 Not Found if the record does not exist or the user is not the owner.
 */
export const updateWatchedAt = async (dto: UpdateWatchedAtDto): Promise<IWatchedMovie> => {
    const result = await pool.query<IWatchedMovie>(movieQueries.movies.watched.updateWatchedAt, [
        dto.watchedMovieId,
        dto.userId,
        dto.watchedAt,
    ]);

    const updated = result.rows[0];
    if (!updated) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }

    return updated;
};

/**
 * Deletes a specific WatchedMovie record by its ID.
 *
 * @param dto - Data transfer object containing watchedMovieId and userId.
 * @returns The deleted WatchedMovie record.
 * @throws {ApiError} 404 Not Found if the record does not exist or the user is not the owner.
 */
export const deleteWatchedById = async (dto: DeleteWatchedByIdDto): Promise<IWatchedMovie> => {
    const result = await pool.query<IWatchedMovie>(movieQueries.movies.watched.deleteById, [
        dto.watchedMovieId,
        dto.userId,
    ]);

    const deleted = result.rows[0];
    if (!deleted) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }

    return deleted;
};

/**
 * Retrieves all WatchedMovie records for a specific user and movie.
 *
 * @param dto - Data transfer object containing userId and movieId.
 * @returns Array of WatchedMovie records ordered by watchedAt descending.
 */
export const getWatchedByMovieId = async (dto: GetWatchedByMovieIdDto): Promise<IWatchedMovie[]> => {
    const result = await pool.query<IWatchedMovie>(movieQueries.movies.watched.getByMovieId, [
        dto.userId,
        dto.movieId,
    ]);
    return result.rows;
};

/**
 * Completely removes a movie from the user's watched history.
 * If the user has watched the movie multiple times, this will delete all of those records.
 *
 * @param dto - Data transfer object containing userId and movieId.
 * @returns The deleted WatchedMovie record or null if not found.
 */
export const unmarkAsWatched = async (dto: UserMovieActionDto): Promise<IWatchedMovie[]> => {
    const result = await pool.query<IWatchedMovie>(movieQueries.movies.watched.remove, [dto.userId, dto.movieId]);
    return result.rows;
};

/**
 * Fetches detailed information about a movie by its ID, including up to 3 recent user comments.
 *
 * @param {GetMovieDto} dto - Data transfer object containing the movie ID.
 * @returns {<GetMovieResponse>} The movie details along with its recent interactions.
 */
export const getMovie = async (dto: GetMovieDto): Promise<GetMovieResponse> => {
    const result = await pool.query<GetMovieResponse>(movieQueries.movies.getById, [
        dto.movieId,
        dto.currentUserId || null,
    ]);
    return result.rows[0];
};

/**
 * Adds a specific movie to the authenticated user's watchlist.
 *
 * @param dto - Data transfer object containing userId and movieId.
 * @returns The newly created MovieListItem record representing the watchlist entry.
 */
export const addToWatchlist = async (dto: UserMovieActionDto): Promise<IMovieListItem> => {
    const result = await pool.query<IMovieListItem>(movieQueries.movies.watchlist.add, [dto.userId, dto.movieId]);
    return result.rows[0];
};

/**
 * Completely removes a specific movie from the authenticated user's watchlist.
 * This operation deletes all associated records for that movie in the MovieListItem table.
 *
 * @param dto - Data transfer object containing userId and movieId.
 * @returns The deleted MovieListItem record or null if the movie was not in the watchlist.
 */
export const removeFromWatchlist = async (dto: UserMovieActionDto): Promise<IMovieListItem[]> => {
    const result = await pool.query<IMovieListItem>(movieQueries.movies.watchlist.remove, [dto.userId, dto.movieId]);
    return result.rows;
};

/**
 * Adds a specific movie to the authenticated user's favorites list.
 *
 * @param dto - Data transfer object containing userId and movieId.
 * @returns The newly created MovieListItem record representing the favorite entry.
 */
export const addToFavorites = async (
    userId: string,
    data: { movieId?: MovieId; tmdbId?: TmdbId; replaceMovieId?: MovieId }
): Promise<IMovieListItem> => {
    const { movieId, tmdbId, replaceMovieId } = data;

    // 1. Eğer replaceMovieId verilmişse eski favoriyi kaldır
    if (replaceMovieId) {
        await pool.query(movieQueries.movies.favorites.remove, [userId, replaceMovieId]);
    }

    // 2. Eğer movieId yoksa ama tmdbId varsa filmi bul veya tmdb'den çek
    let targetMovieId: MovieId | undefined = movieId;
    if (!targetMovieId && tmdbId) {
        const checkResult = await pool.query(movieQueries.movies.checkExists, [tmdbId]);
        if (checkResult.rows.length > 0) {
            targetMovieId = checkResult.rows[0].id;
        } else {
            const tmdbMovie = await tmdbService.getMovieByTmdbId(tmdbId);
            const values = [
                tmdbMovie.tmdbId,
                tmdbMovie.title,
                tmdbMovie.poster,
                tmdbMovie.releaseDate,
                tmdbMovie.rating,
                tmdbMovie.genres,
                tmdbMovie.duration,
                tmdbMovie.overview,
            ];
            const insertResult = await pool.query(movieQueries.movies.insertMovie, values);
            targetMovieId = insertResult.rows[0].id;
        }
    }

    if (!targetMovieId) {
        throw new ApiError("NOT_FOUND", 404);
    }

    // 3. Limit kontrolü
    const countResult = await pool.query(
        `SELECT COUNT(*) FROM "MovieListItem" mli
         JOIN "MovieList" ml ON ml.id = mli."movieListId"
         WHERE ml."listType" = 'favorites' AND ml."creatorId" = $1`,
        [userId]
    );

    const count = parseInt(countResult.rows[0].count, 10);
    if (count >= 3) {
        throw new ApiError("MAX_FAVORITES_FILM_REACHED", 400);
    }

    // 4. Favoriye ekle
    const result = await pool.query<IMovieListItem>(movieQueries.movies.favorites.add, [userId, targetMovieId]);
    return result.rows[0];
};

/**
 * Completely removes a specific movie from the authenticated user's favorites list.
 *
 * @param dto - Data transfer object containing userId and movieId.
 * @returns The deleted MovieListItem record or null if the movie was not in the favorites list.
 */
export const removeFromFavorites = async (dto: UserMovieActionDto): Promise<IMovieListItem[]> => {
    const result = await pool.query<IMovieListItem>(movieQueries.movies.favorites.remove, [dto.userId, dto.movieId]);
    return result.rows;
};

/**
 * Updates the details of an existing movie list.
 *
 * @param dto - Data transfer object containing the movie list ID and updated details.
 * @returns The updated MovieList record.
 * @throws {ApiError} 404 Not Found if the movie list does not exist.
 */
export const updateList = async (dto: UpdateMovieListDto): Promise<IMovieList> => {
    const { listId, userId, title, description, image, isPrivate } = dto;

    const result = await pool.query<IMovieList>(movieQueries.lists.update, [
        title ?? null,
        description !== undefined ? description : null,
        image !== undefined ? image : null,
        isPrivate ?? null,
        listId,
        userId,
        image !== undefined,
        description !== undefined,
    ]);
    const updatedList = result.rows[0];

    if (!updatedList) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }

    return updatedList;
};

/**
 * Deletes a movie list and all associated items.
 *
 * @param dto - Data transfer object containing the movie list ID and user ID.
 * @returns void
 * @throws {ApiError} 404 Not Found if the movie list does not exist or the user is not the creator.
 */
export const deleteList = async (dto: DeleteListDto): Promise<void> => {
    const { listId, userId } = dto;

    const result = await pool.query<IMovieList>(movieQueries.lists.delete, [listId, userId]);
    const deletedList = result.rows[0];

    if (!deletedList) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }
};

/**
 * Retrieves a movie list by its ID, including owners, preview movies, and latest comments.
 *
 * @param dto - Data transfer object containing the movie list ID and optional user ID for permission checks.
 * @returns The movie list details along with owners, preview movies, and latest comments.
 * @throws {ApiError} 404 Not Found if the movie list does not exist or the user does not have permission to access it.
 */
export const getListById = async (dto: GetListByIdDto): Promise<GetListByIdResponse> => {
    const { listId, userId } = dto;

    const result = await pool.query<GetListByIdResponse>(movieQueries.lists.getById, [listId, userId ?? null]);
    const movieList = result.rows[0];

    if (!movieList) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }

    return movieList;
};

/**
 * Retrieves all movies within a specific movie list, including their interactions.
 *
 * @param dto - Data transfer object containing the movie list ID and optional user ID for context.
 * @returns An array of movie summary items with interaction details.
 * @throws {ApiError} 404 Not Found if the movie list does not exist or the user does not have permission to access it.
 */
export const getListItems = async (dto: GetListItemsDto): Promise<GetListItemsResponse> => {
    const { listId, userId, page, limit } = dto;

    const offset = (page - 1) * limit;

    const accessResult = await pool.query<{ id: string; hasAccess: boolean }>(movieQueries.lists.checkAccess, [
        listId,
        userId,
    ]);

    if (accessResult.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    if (!accessResult.rows[0].hasAccess) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }

    const result = await pool.query<MovieSummary>(movieQueries.lists.items.getMovies, [
        listId,
        userId ?? null,
        limit,
        offset,
    ]);

    return result.rows;
};

/**
 * Retrieves all interactions/comments for a specific movie list.
 */
export const getListInteractions = async (dto: GetListItemsDto & { currentUserId?: string }) => {
    const { listId, currentUserId, page, limit } = dto;
    const offset = (page - 1) * limit;

    const result = await pool.query(movieQueries.lists.items.getInteractions, [listId, limit, offset, currentUserId || null]);

    return result.rows;
};

/**
 * Retrieves all interactions/comments for a specific movie.
 */
export const getMovieInteractions = async (dto: { movieId: string; currentUserId?: string; limit: number; page: number }) => {
    const { movieId, currentUserId, limit, page } = dto;
    const offset = (page - 1) * limit;

    let targetMovieId = movieId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(movieId);
    if (!isUuid) {
        const tmdbIdNum = parseInt(movieId, 10);
        if (!isNaN(tmdbIdNum)) {
            const movieRow = await pool.query<{ id: string }>('SELECT id FROM "Movie" WHERE "tmdbId" = $1 LIMIT 1', [tmdbIdNum]);
            if (movieRow.rows.length > 0) {
                targetMovieId = movieRow.rows[0].id;
            } else {
                return [];
            }
        } else {
            return [];
        }
    }

    const result = await pool.query(movieQueries.movies.getInteractions, [targetMovieId, limit, offset, currentUserId || null]);

    return result.rows;
};

/**
 * Adds a specific movie to a custom movie list.
 *
 * @param dto - Data transfer object containing the movie list ID, movie ID, and user ID of the person adding the movie.
 * @returns The newly created MovieListItem record representing the added movie.
 * @throws {ApiError} 404 Not Found if the movie list does not exist, the movie already exists in the list, or the user does not have permission to modify it.
 */
export const addItemToList = async (dto: MovieListItemDto): Promise<IMovieListItem> => {
    const { listId, movieId, userId } = dto;

    const result = await pool.query<IMovieListItem>(movieQueries.lists.items.addMovie, [listId, movieId, userId]);
    const addedItem = result.rows[0];

    if (!addedItem) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }

    return addedItem;
};

/**
 * Removes a specific movie from a custom movie list.
 *
 * @param dto - Data transfer object containing the movie list ID, movie ID, and user ID of the person removing the movie.
 * @returns void
 * @throws {ApiError} 404 Not Found if the movie list does not exist, the movie is not in the list, or the user does not have permission to modify it.
 */
export const removeItemFromList = async (dto: MovieListItemDto): Promise<void> => {
    const { listId, movieId, userId } = dto;

    const result = await pool.query<IMovieListItem>(movieQueries.lists.items.removeMovie, [listId, movieId, userId]);
    const removedItems = result.rows;

    if (removedItems.length === 0) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }
};

/**
 * Likes a specific movie list for the authenticated user.
 *
 * @param dto - Data transfer object containing the userId and listId.
 * @returns An object containing the listId and isLiked status.
 * @throws {ApiError} 404 Not Found if the movie list does not exist or the user does not have permission to like it.
 */
export const likeList = async (dto: LikeMovieListDto): Promise<LikeMovieListResponse> => {
    const { userId, listId } = dto;
    const result = await pool.query<LikeMovieListResponse>(movieQueries.lists.likes.add, [userId, listId]);

    if (result.rowCount === 0) {
        throw new ApiError("ACTION_FAILED_NO_PERMISSION", 404);
    }

    // Send notification to list creator (if not liking own list)
    const listRes = await pool.query<{ creatorId: string; title: string }>(
        `SELECT "creatorId", "title" FROM "MovieList" WHERE id = $1`,
        [listId],
    );
    if (listRes.rows.length > 0) {
        const list = listRes.rows[0];
        if (list.creatorId !== userId) {
            const userRes = await pool.query<{ username: string; fullname: string }>(
                `SELECT username, fullname FROM "User" WHERE id = $1`,
                [userId],
            );
            const liker = userRes.rows[0];
            const likerName = liker?.fullname || liker?.username || "Bir kullanıcı";

            await createNotification({
                recipientId: list.creatorId,
                actorId: userId,
                type: "like",
                targetType: "movie_list",
                targetId: listId,
                pushTitle: "Yeni Beğeni",
                pushBody: `${likerName} "${list.title}" film listeni beğendi.`,
                path: `/movie-lists/${listId}`,
            });
        }
    }

    return result.rows[0];
};

/**
 * Unlikes a specific movie list for the authenticated user.
 *
 * @param dto - Data transfer object containing the userId and listId.
 * @returns An object containing the listId and isLiked status.
 * @throws {ApiError} 404 Not Found if the movie list does not exist or the user does not have permission to unlike it.
 */
export const unlikeList = async (dto: UnlikeMovieListDto): Promise<UnlikeMovieListResponse> => {
    const { userId, listId } = dto;
    const result = await pool.query<UnlikeMovieListResponse>(movieQueries.lists.likes.remove, [userId, listId]);

    if (result.rowCount === 0) {
        throw new ApiError("ACTION_FAILED_NO_PERMISSION", 404);
    }

    // Clean up unread notification
    await pool.query(
        `DELETE FROM "Notification"
         WHERE "actorId" = $1 AND "type" = 'like' AND "targetType" = 'movie_list' AND "targetId" = $2 AND "isRead" = false`,
        [userId, listId],
    );

    return result.rows[0];
};

/**
 * Likes a specific movie for the authenticated user.
 *
 * @param dto - Data transfer object containing the userId and movieId.
 * @returns An object containing the movieId and isLiked status.
 * @throws {ApiError} 404 Not Found if the movie does not exist or the user does not have permission to like it.
 */
export const likeMovie = async (dto: LikeMovieDto): Promise<LikeMovieResponse> => {
    const { userId, movieId } = dto;
    const result = await pool.query<LikeMovieResponse>(movieQueries.movies.likes.add, [userId, movieId]);

    if (result.rowCount === 0) {
        throw new ApiError("ACTION_FAILED_NO_PERMISSION", 404);
    }

    return result.rows[0];
};

/**
 * Unlikes a specific movie for the authenticated user.
 *
 * @param dto - Data transfer object containing the userId and movieId.
 * @returns An object containing the movieId and isLiked status.
 * @throws {ApiError} 404 Not Found if the movie does not exist or the user does not have permission to unlike it.
 */
export const unlikeMovie = async (dto: UnlikeMovieDto): Promise<UnlikeMovieResponse> => {
    const { userId, movieId } = dto;
    const result = await pool.query<UnlikeMovieResponse>(movieQueries.movies.likes.remove, [userId, movieId]);

    if (result.rowCount === 0) {
        throw new ApiError("ACTION_FAILED_NO_PERMISSION", 404);
    }

    return result.rows[0];
};

export interface UpsertMovieInteractionDto {
    userId: string;
    movieId: string;
    targetType?: string;
    rating?: number | null;
    comment?: string | null;
    isLiked?: boolean;
}

export const upsertMovieInteraction = async (dto: UpsertMovieInteractionDto) => {
    const { userId, movieId, targetType, rating, comment, isLiked } = dto;
    const ratingVal = typeof rating === "number" && rating >= 0 ? rating : null;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const interactionResult = await client.query(movieQueries.movies.interaction.upsert, [
            userId,
            movieId,
            ratingVal,
            isLiked ?? false,
            targetType || "movie",
        ]);
        const interaction = interactionResult.rows[0];

        const commentData = await upsertInteractionComment(client, interaction.id, userId, comment);

        await client.query(movieQueries.movies.interaction.cleanupEmpty, [interaction.id]);

        await client.query("COMMIT");

        return {
            id: interaction.id,
            movieId,
            rating: interaction.rating,
            isLiked: interaction.isLiked,
            comment: commentData
                ? { id: commentData.id, content: commentData.content, date: commentData.createdAt }
                : null,
        };
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
};

export const findOrFetchFromTmdb = async (dto: FindOrFetchFromTmdbDto): Promise<GetMovieResponse> => {
    const { tmdbId, userId } = dto;

    const checkResult = await pool.query(movieQueries.movies.checkExists, [tmdbId]);

    let movieId: number;

    if (checkResult.rows.length > 0) {
        movieId = checkResult.rows[0].id;
    } else {
        const tmdbMovie = await tmdbService.getMovieByTmdbId(tmdbId);

        const values = [
            tmdbMovie.tmdbId,
            tmdbMovie.title,
            tmdbMovie.poster,
            tmdbMovie.releaseDate,
            tmdbMovie.rating,
            tmdbMovie.genres,
            tmdbMovie.duration,
            tmdbMovie.overview,
        ];

        const insertResult = await pool.query(movieQueries.movies.insertMovie, values);
        movieId = insertResult.rows[0].id;
    }

    const finalResult = await pool.query<GetMovieResponse>(movieQueries.movies.getById, [movieId, userId]);

    return finalResult.rows[0];
};
