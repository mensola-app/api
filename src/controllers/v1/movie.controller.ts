import { Response, NextFunction } from "express";

// Services
import {
    getFavorites,
    getWatchlist,
    getWatched,
    getLikedMovies,
    getUserLists,
    getLikedLists,
    createList,
    markAsWatched,
    unmarkAsWatched,
    getMovie,
    addToWatchlist,
    removeFromWatchlist,
    addToFavorites,
    removeFromFavorites,
    updateList,
    deleteList,
    getListById,
    getListItems,
    getListInteractions,
    getMovieInteractions,
    addItemToList,
    removeItemFromList,
    likeList,
    unlikeList,
    likeMovie as likeMovieService,
    unlikeMovie as unlikeMovieService,
    upsertMovieInteraction,
    UpsertMovieInteractionDto,
    findOrFetchFromTmdb,
    updateWatchedAt,
    deleteWatchedById,
    getWatchedByMovieId,
} from "@/services/movie.service";

// Utilities
import { sendResponse } from "@/utils/response";
import { ApiError } from "@/utils/error";

// Types
import { TypedRequestBody, TypedRequestQuery, TypedRequest } from "@/types/express.types";
import {
    GetFavoritesDto,
    GetWatchlistDto,
    GetWatchedMoviesDto,
    GetLikedMoviesDto,
    GetUserListsDto,
    GetLikedListsDto,
    CreateMovieListDto,
    GetMovieDto,
    UpdateMovieListDto,
    MovieListItemDto,
    LikeMovieListDto,
    UnlikeMovieListDto,
    LikeMovieDto,
    UnlikeMovieDto,
} from "@/types/movie.types";
import { MovieId, MovieListId, PaginationQueries, TmdbId } from "@/types/common.types";
import { MESSAGES } from "@/constants/messages";

/* ==========================================================================
   Movie Library Controllers
   ========================================================================== */

/**
 * Retrieves a paginated list of favorite movies for a target user (or current user).
 *
 * @route   GET /api/movies/favorites
 * @access  Public / Optional Auth
 */
const getFavoriteMovies = async (
    req: TypedRequestQuery<Partial<GetFavoritesDto>>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.query.userId || req.user?.id;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 18;

        const favoriteMovies = await getFavorites({ userId, limit, page });

        return sendResponse(res, 200, {
            items: favoriteMovies,
            page,
            limit,
            hasMore: favoriteMovies.length === limit,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves a paginated watchlist of movies for a target user (or current user).
 *
 * @route   GET /api/movies/watchlist
 * @access  Public / Optional Auth
 */
const getWatchlistMovies = async (
    req: TypedRequestQuery<Partial<GetWatchlistDto>>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.query.userId || req.user?.id;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 18;

        const watchlist = await getWatchlist({ userId, limit, page });

        return sendResponse(res, 200, {
            items: watchlist,
            page,
            limit,
            hasMore: watchlist.length === limit,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves a paginated list of watched movies for a target user (or current user).
 *
 * @route   GET /api/movies/watched
 * @access  Public / Optional Auth
 */
const getWatchedMovies = async (
    req: TypedRequestQuery<Partial<GetWatchedMoviesDto>>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.query.userId || req.user?.id;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 18;

        const watchedMovies = await getWatched({ userId, limit, page });

        return sendResponse(res, 200, {
            items: watchedMovies,
            page,
            limit,
            hasMore: watchedMovies.length === limit,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves a paginated list of liked movies for a target user (or current user).
 *
 * @route   GET /api/movies/likes
 * @access  Public / Optional Auth
 */
const getLikedMoviesList = async (
    req: TypedRequestQuery<Partial<GetLikedMoviesDto>>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.query.userId || req.user?.id;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 18;

        const likedMovies = await getLikedMovies({ userId, limit, page });

        return sendResponse(res, 200, {
            items: likedMovies,
            page,
            limit,
            hasMore: likedMovies.length === limit,
        });
    } catch (error) {
        next(error);
    }
};

/* ==========================================================================
   Custom Movie Lists Controllers
   ========================================================================== */

/**
 * Retrieves custom movie lists created by a target user with preview items.
 *
 * @route   GET /api/movies/lists
 * @access  Public / Optional Auth
 */
const getMovieLists = async (req: TypedRequestQuery<Partial<GetUserListsDto>>, res: Response, next: NextFunction) => {
    try {
        const currentUserId = req.user?.id;
        const userId = req.query.userId || req.user?.id;
        const movieId = req.query.movieId;

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 5;

        const lists = await getUserLists({ userId, currentUserId, limit, page, movieId });

        return sendResponse(res, 200, {
            items: lists,
            page,
            limit,
            hasMore: lists.length === limit,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves custom movie lists liked by a target user.
 *
 * @route   GET /api/movies/lists/likes
 * @access  Public / Optional Auth
 */
const getLikedMovieLists = async (
    req: TypedRequestQuery<Partial<GetLikedListsDto>>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const currentUserId = req.user?.id;
        const userId = req.query.userId || req.user?.id;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 5;

        const likedLists = await getLikedLists({
            userId,
            currentUserId,
            limit,
            page,
        });

        return sendResponse(res, 200, {
            items: likedLists,
            page,
            limit,
            hasMore: likedLists.length === limit,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Creates a new custom movie list for the authenticated user.
 *
 * @route   POST /api/movies/lists
 * @access  Private (Requires Access Token)
 */
const createMovieList = async (
    req: TypedRequestBody<Omit<CreateMovieListDto, "creatorId">>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const { title, description, image, isPrivate } = req.body;
        const creatorId = req.user!.id;

        const newMovieList = await createList({
            title,
            description,
            image,
            isPrivate,
            creatorId,
        });

        return sendResponse(res, 201, newMovieList, MESSAGES.SUCCESS.CREATED_SUCCESSFULLY);
    } catch (error) {
        next(error);
    }
};

/**
 * Marks a specific movie as watched for the authenticated user.
 *
 * @route   POST /api/movies/:movieId/watched
 * @access  Private (Requires Access Token)
 */
const markMovieAsWatched = async (
    req: TypedRequest<{ movieId: MovieId }, { watchedAt?: string | null }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const movieId = req.params.movieId;
        const watchedAt = req.body?.watchedAt ?? null;

        const watchedMovie = await markAsWatched({ userId, movieId, watchedAt });
        return sendResponse(res, 201, watchedMovie);
    } catch (error) {
        next(error);
    }
};

/**
 * Removes all watch records of a specific movie for the authenticated user.
 *
 * @route   DELETE /api/movies/:movieId/watched
 * @desc    Completely removes the movie from the user's watched history.
 * @access  Private (Requires Access Token)
 */

const unmarkMovieAsWatched = async (req: TypedRequest<{ movieId: MovieId }>, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;
        const movieId = req.params.movieId;

        const deletedRecord = await unmarkAsWatched({ userId, movieId });
        if (deletedRecord.length === 0) {
            throw new ApiError("NOT_IN_HISTORY", 404);
        }

        return sendResponse(res, 200, null, MESSAGES.SUCCESS.MOVIE_REMOVED_WATCHED);
    } catch (error) {
        next(error);
    }
};

/**
 * Updates the watchedAt timestamp of a specific watched movie record.
 *
 * @route   PATCH /api/movies/watched/:watchedMovieId
 * @access  Private (Requires Access Token)
 */
const updateWatchedAtEntry = async (
    req: TypedRequest<{ watchedMovieId: string }, { watchedAt: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const watchedMovieId = req.params.watchedMovieId as any;
        const { watchedAt } = req.body;

        const updated = await updateWatchedAt({ watchedMovieId, userId, watchedAt });
        return sendResponse(res, 200, updated, MESSAGES.SUCCESS.UPDATED_SUCCESSFULLY);
    } catch (error) {
        next(error);
    }
};

/**
 * Deletes a specific watched movie record by its ID.
 *
 * @route   DELETE /api/movies/watched/:watchedMovieId
 * @access  Private (Requires Access Token)
 */
const deleteWatchedEntry = async (
    req: TypedRequest<{ watchedMovieId: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const watchedMovieId = req.params.watchedMovieId as any;

        await deleteWatchedById({ watchedMovieId, userId });
        return sendResponse(res, 200, null, MESSAGES.SUCCESS.DELETED_SUCCESSFULLY);
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves all watched history records for the authenticated user for a specific movie.
 *
 * @route   GET /api/movies/:movieId/watched-history
 * @access  Private (Requires Access Token)
 */
const getWatchedHistoryByMovieId = async (
    req: TypedRequest<{ movieId: MovieId }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const movieId = req.params.movieId;

        const records = await getWatchedByMovieId({ userId, movieId });
        return sendResponse(res, 200, records);
    } catch (error) {
        next(error);
    }
};


/**
 * Retrieves a movie's details and its latest interactions by ID.
 *
 * @route   GET /api/movies/:movieId
 * @desc    Get detailed information about a specific movie.
 * @access  Public (or Private depending on your auth setup)
 */
const getMovieById = async (req: TypedRequest<GetMovieDto>, res: Response, next: NextFunction) => {
    try {
        const currentUserId = req.user?.id;
        const movieId = req.params.movieId;

        const movie = await getMovie({ movieId, currentUserId });
        if (!movie) {
            throw new ApiError("NOT_FOUND", 404);
        }

        return sendResponse(res, 200, movie);
    } catch (error) {
        next(error);
    }
};

/**
 * Adds a specific movie to the authenticated user's watchlist.
 *
 * @route   POST /api/movies/:movieId/watchlist
 * @desc    Add a movie to the authenticated user's watchlist
 * @access  Private (Requires Access Token)
 */
const addMovieToWatchlist = async (req: TypedRequest<{ movieId: MovieId }>, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;
        const movieId = req.params.movieId;

        const watchlistItem = await addToWatchlist({ userId, movieId });
        return sendResponse(res, 201, watchlistItem);
    } catch (error) {
        next(error);
    }
};

/**
 * Removes a specific movie from the authenticated user's watchlist.
 *
 * @route   DELETE /api/movies/:movieId/watchlist
 * @desc    Completely removes a movie from the user's watchlist.
 * @access  Private (Requires Access Token)
 */
const removeMovieFromWatchlist = async (req: TypedRequest<{ movieId: MovieId }>, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;
        const movieId = req.params.movieId;

        const deletedRecord = await removeFromWatchlist({ userId, movieId });
        if (!deletedRecord || deletedRecord.length === 0) {
            throw new ApiError("NOT_IN_WATCHLIST", 404);
        }

        return sendResponse(res, 200, null, MESSAGES.SUCCESS.MOVIE_REMOVED_WATCHED);
    } catch (error) {
        next(error);
    }
};

/**
 * Adds a specific movie to the authenticated user's favorites list.
 *
 * @route   POST /api/movies/:movieId/favorites
 * @desc    Add a movie to the authenticated user's favorites list
 * @access  Private (Requires Access Token)
 */
const addMovieToFavorites = async (
    req: TypedRequest<{}, { movieId?: MovieId; tmdbId?: TmdbId; replaceMovieId?: MovieId }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const { movieId, tmdbId, replaceMovieId } = req.body;

        const favoriteItem = await addToFavorites(userId, { movieId, tmdbId, replaceMovieId });
        return sendResponse(res, 201, favoriteItem);
    } catch (error) {
        next(error);
    }
};

/**
 * Removes a specific movie from the authenticated user's favorites list.
 *
 * @route   DELETE /api/movies/:movieId/favorites
 * @desc    Completely removes a movie from the user's favorites list.
 * @access  Private (Requires Access Token)
 */
const removeMovieFromFavorites = async (req: TypedRequest<{ movieId: MovieId }>, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;
        const movieId = req.params.movieId;

        const deletedRecord = await removeFromFavorites({ userId, movieId });
        if (!deletedRecord || deletedRecord.length === 0) {
            throw new ApiError("NOT_IN_FAVORITES", 404);
        }

        return sendResponse(res, 200, null, MESSAGES.SUCCESS.MOVIE_REMOVED_FAVORITES);
    } catch (error) {
        next(error);
    }
};

/**
 * Updates a custom movie list if the authenticated user is the creator or a co-owner.
 *
 * @route   PATCH /api/movies/lists/:listId
 * @desc    Updates the details of an existing movie list.
 * @access  Private (Requires Access Token)
 */
const updateMovieList = async (
    req: TypedRequest<{ listId: MovieListId }, Omit<UpdateMovieListDto, "listId" | "userId">>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const listId = req.params.listId;
        const { title, description, image, isPrivate } = req.body;

        const updatedList = await updateList({
            listId,
            userId,
            title,
            description,
            image,
            isPrivate,
        });
        return sendResponse(res, 200, updatedList, MESSAGES.SUCCESS.UPDATED_SUCCESSFULLY);
    } catch (error) {
        next(error);
    }
};

/**
 * Deletes a custom movie list if the authenticated user is the creator or a co-owner.
 *
 * @route   DELETE /api/movies/lists/:listId
 * @desc    Deletes an existing movie list.
 * @access  Private (Requires Access Token)
 */
const deleteMovieList = async (req: TypedRequest<{ listId: MovieListId }>, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;
        const listId = req.params.listId;

        await deleteList({ listId, userId });
        return sendResponse(res, 200, null, MESSAGES.SUCCESS.DELETED_SUCCESSFULLY);
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves a movie list by its ID, including owners, preview movies, and latest comments.
 *
 * @route   GET /api/movies/lists/:listId
 * @desc    Fetches a specific movie list with detailed information.
 * @access  Public / Optional Auth (Attaches viewer context if token provided)
 */
const getMovieListById = async (req: TypedRequest<{ listId: MovieListId }>, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        const listId = req.params.listId;

        const movieList = await getListById({ listId, userId });
        return sendResponse(res, 200, movieList);
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves all movies within a specific movie list, including their interactions.
 *
 * @route   GET /api/movies/lists/:listId/items
 * @desc    Fetches all movies contained in a specific movie list.
 * @access  Public / Optional Auth (Attaches viewer context if token provided)
 */
const getMovieListItems = async (
    req: TypedRequest<{ listId: MovieListId }, {}, Partial<PaginationQueries>>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user?.id;
        const listId = req.params.listId;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 18;

        const movieItems = await getListItems({ listId, userId, limit, page });
        return sendResponse(res, 200, { items: movieItems, page, limit, hasMore: movieItems.length === limit });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves all comments/interactions for a specific custom movie list.
 *
 * @route   GET /api/movies/lists/:listId/interactions
 * @access  Public / Optional Auth
 */
const getMovieListInteractions = async (
    req: TypedRequest<{ listId: MovieListId }, {}, Partial<PaginationQueries>>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const currentUserId = req.user?.id;
        const listId = req.params.listId;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 18;

        const interactions = await getListInteractions({ listId, currentUserId, limit, page });
        return sendResponse(res, 200, { items: interactions, page, limit, hasMore: interactions.length === limit });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves all interactions (comments, ratings, likes) for a specific movie.
 *
 * @route   GET /api/movies/:movieId/interactions
 * @access  Public / Optional Auth
 */
const getMovieInteractionsList = async (
    req: TypedRequest<{ movieId: MovieId }, {}, Partial<PaginationQueries>>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const currentUserId = req.user?.id;
        const movieId = req.params.movieId;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 18;

        const interactions = await getMovieInteractions({ movieId, currentUserId, limit, page });
        return sendResponse(res, 200, { items: interactions, page, limit, hasMore: interactions.length === limit });
    } catch (error) {
        next(error);
    }
};

/**
 * Creates or updates a user interaction (rating, comment, like) for a custom movie list.
 *
 * @route   POST /api/movies/lists/:listId/interaction
 * @access  VerifyToken
 */
const createMovieListInteraction = async (
    req: TypedRequest<{ listId: MovieListId }, UpsertMovieInteractionDto>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const listId = req.params.listId;
        const { rating, comment, isLiked } = req.body;

        const result = await upsertMovieInteraction({
            userId,
            movieId: listId,
            targetType: "movieList",
            rating,
            comment,
            isLiked,
        });

        return sendResponse(res, 200, result, MESSAGES.SUCCESS.INTERACTION_SAVED);
    } catch (error) {
        next(error);
    }
};

/**
 * Adds a specific movie to a custom movie list for the authenticated user.
 *
 * @route   POST /api/movies/lists/:listId/items
 * @desc    Adds a movie to a specific movie list.
 * @access  VerifyToken (Requires valid Access Token)
 */
const addMovieToList = async (
    req: TypedRequest<Omit<MovieListItemDto, "userId">>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const listId = req.params.listId;
        const movieId = req.params.movieId;
        const userId = req.user!.id;

        const addedItem = await addItemToList({ listId, movieId, userId });
        return sendResponse(res, 201, addedItem);
    } catch (error) {
        next(error);
    }
};

/**
 * Removes a specific movie from a custom movie list for the authenticated user.
 *
 * @route   DELETE /api/movies/lists/:listId/items/:movieId
 * @desc    Removes a movie from a specific movie list.
 * @access  VerifyToken (Requires valid Access Token)
 */
const removeMovieFromList = async (
    req: TypedRequest<Omit<MovieListItemDto, "userId">>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const listId = req.params.listId;
        const movieId = req.params.movieId;
        const userId = req.user!.id;

        await removeItemFromList({ listId, movieId, userId });
        return sendResponse(res, 200, null, MESSAGES.SUCCESS.REMOVED_FROM_LIST);
    } catch (error) {
        next(error);
    }
};

/**
 * Likes a specific movie list for the authenticated user.
 * If the list is already liked, it will unlike it (toggle behavior).
 *
 * @route   POST /api/movies/lists/:listId/like
 * @desc    Likes or unlikes a specific movie list.
 * @access  Private (Requires valid Access Token)
 */
const likeMovieList = async (req: TypedRequest<LikeMovieListDto>, res: Response, next: NextFunction) => {
    try {
        const listId = req.params.listId;
        const userId = req.user!.id;

        const likeResult = await likeList({ userId, listId });
        return sendResponse(res, 201, likeResult);
    } catch (error) {
        next(error);
    }
};

/**
 * Unlikes a specific movie list for the authenticated user.
 *
 * @route   DELETE /api/movies/lists/:listId/like
 * @desc    Unlikes a specific movie list.
 * @access  Private (Requires valid Access Token)
 */
const unlikeMovieList = async (req: TypedRequest<UnlikeMovieListDto>, res: Response, next: NextFunction) => {
    try {
        const listId = req.params.listId;
        const userId = req.user!.id;

        const unlikeResult = await unlikeList({ userId, listId });
        return sendResponse(res, 200, unlikeResult);
    } catch (error) {
        next(error);
    }
};

/**
 * Likes a specific movie for the authenticated user.
 * If the movie is already liked, it will unlike it (toggle behavior).
 *
 * @route   POST /api/movies/:movieId/like
 * @desc    Likes or unlikes a specific movie.
 * @access  Private (Requires valid Access Token)
 */
const likeMovie = async (req: TypedRequest<Omit<LikeMovieDto, "userId">>, res: Response, next: NextFunction) => {
    try {
        const movieId = req.params.movieId;
        const userId = req.user!.id;

        const likeResult = await likeMovieService({ userId, movieId });
        return sendResponse(res, 201, likeResult);
    } catch (error) {
        next(error);
    }
};

/**
 * Unlikes a specific movie for the authenticated user.
 *
 * @route   DELETE /api/movies/:movieId/like
 * @desc    Unlikes a specific movie.
 * @access  Private (Requires valid Access Token)
 */
const unlikeMovie = async (req: TypedRequest<Omit<UnlikeMovieDto, "userId">>, res: Response, next: NextFunction) => {
    try {
        const movieId = req.params.movieId;
        const userId = req.user!.id;

        const unlikeResult = await unlikeMovieService({ userId, movieId });
        return sendResponse(res, 200, unlikeResult);
    } catch (error) {
        next(error);
    }
};

/**
 * Creates or updates an interaction (rating, comment, isLiked) for a movie.
 *
 * @route   POST /api/movies/:movieId/interaction
 * @access  Private
 */
const createMovieInteraction = async (
    req: TypedRequest<{ movieId: MovieId }, { rating?: number; comment?: string; isLiked?: boolean }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const movieId = req.params.movieId;
        const userId = req.user!.id;
        const { rating, comment, isLiked } = req.body;

        const result = await upsertMovieInteraction({
            userId,
            movieId,
            rating,
            comment,
            isLiked,
        });

        return sendResponse(res, 200, result, MESSAGES.SUCCESS.INTERACTION_SAVED);
    } catch (error) {
        next(error);
    }
};

const getOrFetchTmdbMovie = async (req: TypedRequest<{ tmdbId?: TmdbId }>, res: Response, next: NextFunction) => {
    console.log("================================");
    const tmdbId = req.params.tmdbId;
    const userId = req.user?.id;

    if (!tmdbId) {
        return next(new ApiError("NOT_FOUND"));
    }

    try {
        const result = await findOrFetchFromTmdb({ tmdbId, userId });
        return sendResponse(res, 200, result);
    } catch (error) {
        next(error);
    }
};

/* ==========================================================================
   Exports
   ========================================================================== */

export {
    getFavoriteMovies,
    getWatchlistMovies,
    getWatchedMovies,
    getLikedMoviesList,
    getMovieLists,
    getLikedMovieLists,
    createMovieList,
    markMovieAsWatched,
    unmarkMovieAsWatched,
    updateWatchedAtEntry,
    deleteWatchedEntry,
    getWatchedHistoryByMovieId,
    getMovieById,
    addMovieToWatchlist,
    removeMovieFromWatchlist,
    addMovieToFavorites,
    removeMovieFromFavorites,
    updateMovieList,
    deleteMovieList,
    getMovieListById,
    getMovieListItems,
    getMovieListInteractions,
    createMovieListInteraction,
    addMovieToList,
    removeMovieFromList,
    likeMovieList,
    unlikeMovieList,
    likeMovie,
    unlikeMovie,
    createMovieInteraction,
    getMovieInteractionsList,
    getOrFetchTmdbMovie,
};
