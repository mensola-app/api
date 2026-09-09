import { Router } from "express";

// Controllers
import {
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
} from "@/controllers/v1/movie.controller";

// Middlewares
import { verifyToken, extractUser } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";

// Validation
import {
    moviePaginationQuerySchema,
    createMovieListSchema,
    movieIdParamSchema,
    movieInteractionsParamSchema,
    updateMovieListSchema,
    listIdParamSchema,
    listAndMovieParamsSchema,
    createMovieInteractionSchema,
    tmdbIdParamSchema,
    addFavoriteMovieSchema,
    markMovieAsWatchedSchema,
    updateWatchedAtSchema,
    watchedMovieIdParamSchema,
    watchedHistoryByMovieIdSchema,
} from "@/validations/movie.validation";
import { requiredUserId } from "@/middlewares/requiredId.middleware";

const router = Router();

/* ==========================================================================
   1. User Library & Collection Routes (Static prefixes)
   ========================================================================== */

router.get("/favorites", extractUser, validate(moviePaginationQuerySchema), requiredUserId, getFavoriteMovies);
router.get("/watchlist", extractUser, validate(moviePaginationQuerySchema), requiredUserId, getWatchlistMovies);
router.get("/watched", extractUser, validate(moviePaginationQuerySchema), requiredUserId, getWatchedMovies);
router.get("/likes", extractUser, validate(moviePaginationQuerySchema), requiredUserId, getLikedMoviesList);

/* ==========================================================================
   2. Custom Movie Lists Routes (Static & Dynamic Sub-routes)
   ========================================================================== */

router.get("/lists", extractUser, validate(moviePaginationQuerySchema), requiredUserId, getMovieLists);
router.post("/lists", verifyToken, validate(createMovieListSchema), createMovieList);

// List Like/Unlike Operations
router.get("/lists/likes", extractUser, validate(moviePaginationQuerySchema), requiredUserId, getLikedMovieLists);
router.post("/lists/:listId/like", verifyToken, validate(listIdParamSchema), likeMovieList);
router.delete("/lists/:listId/like", verifyToken, validate(listIdParamSchema), unlikeMovieList);

// List Items & Interaction Operations
router.get("/lists/:listId/items", extractUser, validate(listIdParamSchema), getMovieListItems);
router.get("/lists/:listId/interactions", extractUser, validate(listIdParamSchema), getMovieListInteractions);
router.post("/lists/:listId/interactions", verifyToken, validate(listIdParamSchema), createMovieListInteraction);
router.post("/lists/:listId/interaction", verifyToken, validate(listIdParamSchema), createMovieListInteraction);
router.post("/lists/:listId/items/:movieId", verifyToken, validate(listAndMovieParamsSchema), addMovieToList);
router.delete("/lists/:listId/items/:movieId", verifyToken, validate(listAndMovieParamsSchema), removeMovieFromList);

// Single List Operations
router.get("/lists/:listId", extractUser, validate(listIdParamSchema), getMovieListById);
router.patch("/lists/:listId", verifyToken, validate(updateMovieListSchema), updateMovieList);
router.delete("/lists/:listId", verifyToken, validate(listIdParamSchema), deleteMovieList);

/* ==========================================================================
   4. Single Movie Interactions & Specific Actions
   ========================================================================== */

// TMDB Movies
router.get("/by-tmdb/:tmdbId", extractUser, validate(tmdbIdParamSchema), getOrFetchTmdbMovie);

// Watched Status
router.post("/:movieId/watched", verifyToken, validate(markMovieAsWatchedSchema), markMovieAsWatched);
router.delete("/:movieId/watched", verifyToken, validate(movieIdParamSchema), unmarkMovieAsWatched);

// Watched History by Record ID
router.patch("/watched/:watchedMovieId", verifyToken, validate(updateWatchedAtSchema), updateWatchedAtEntry);
router.delete("/watched/:watchedMovieId", verifyToken, validate(watchedMovieIdParamSchema), deleteWatchedEntry);

// Watched History by Movie ID
router.get("/:movieId/watched-history", verifyToken, validate(watchedHistoryByMovieIdSchema), getWatchedHistoryByMovieId);

// Watchlist Status
router.post("/:movieId/watchlist", verifyToken, validate(movieIdParamSchema), addMovieToWatchlist);
router.delete("/:movieId/watchlist", verifyToken, validate(movieIdParamSchema), removeMovieFromWatchlist);

// Favorites Status
router.post("/favorites", verifyToken, validate(addFavoriteMovieSchema), addMovieToFavorites);
router.delete("/:movieId/favorites", verifyToken, validate(movieIdParamSchema), removeMovieFromFavorites);

// Movie Like Status
router.post("/:movieId/like", verifyToken, validate(movieIdParamSchema), likeMovie);
router.delete("/:movieId/like", verifyToken, validate(movieIdParamSchema), unlikeMovie);

// Full Interaction Status (Rating, Comment, Like)
router.get("/:movieId/interactions", extractUser, validate(movieInteractionsParamSchema), getMovieInteractionsList);
router.post("/:movieId/interactions", verifyToken, validate(createMovieInteractionSchema), createMovieInteraction);
router.post("/:movieId/interaction", verifyToken, validate(createMovieInteractionSchema), createMovieInteraction);

/* ==========================================================================
   4. Catch-all Single Movie Route (MUST BE AT THE VERY BOTTOM)
   ========================================================================== */

router.get("/:movieId", extractUser, validate(movieIdParamSchema), getMovieById);

export default router;
