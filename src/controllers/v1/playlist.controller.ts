import { Response, NextFunction } from "express";

import {
    getUserPlaylists,
    getLikedPlaylists,
    getPlaylistItems,
    addTrackToPlaylist as addTrackToPlaylistService,
    removeTrackFromPlaylist as removeTrackFromPlaylistService,
    getPlaylistDetails,
    getPlaylistInteractions,
    upsertPlaylistInteraction,
    likePlaylist as likePlaylistService,
    unlikePlaylist as unlikePlaylistService,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
} from "@/services/playlist.service";
import { sendResponse } from "@/utils/response";
import { TypedRequest, TypedRequestBody, TypedRequestQuery } from "@/types/express.types";
import { GetUserPlaylistsDto, GetLikedPlaylistsDto, UpsertPlaylistInteractionDto, CreatePlaylistDto, UpdatePlaylistDto } from "@/types/playlist.types";
import { PaginationQueries, PlaylistId, TrackId, UserId } from "@/types/common.types";
import { MESSAGES } from "@/constants/messages";

/**
 * Retrieves a paginated list of playlists for a target user (or current user).
 *
 * @route   GET /api/playlists
 * @access  Public / Optional Auth
 */
export const getUserPlaylistsList = async (
    req: TypedRequestQuery<Partial<GetUserPlaylistsDto>>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const currentUserId = req.user?.id;
        const userId = (req.query.userId || currentUserId) as UserId;

        const trackId = req.query.trackId;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 18;

        const playlists = await getUserPlaylists({ userId, currentUserId, trackId, limit, page });

        return sendResponse(res, 200, {
            items: playlists,
            page,
            limit,
            totalItems: playlists.length,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves a paginated list of playlists liked by a target user (or current user).
 *
 * @route   GET /api/playlists/likes
 * @access  Public / Optional Auth
 */
export const getLikedPlaylistsList = async (
    req: TypedRequestQuery<Partial<GetLikedPlaylistsDto>>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const currentUserId = req.user?.id;
        const userId = (req.query.userId || currentUserId) as UserId;

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 18;

        const playlists = await getLikedPlaylists({ userId, currentUserId, limit, page });

        return sendResponse(res, 200, {
            items: playlists,
            page,
            limit,
            totalItems: playlists.length,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves items/tracks for a specific playlist.
 *
 * @route   GET /api/playlists/:playlistId/items
 * @access  Public / Optional Auth
 */
export const getPlaylistItemsList = async (
    req: TypedRequest<{ playlistId: PlaylistId }, {}, Partial<PaginationQueries>>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const currentUserId = req.user?.id;
        const playlistId = req.params.playlistId;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 18;

        const items = await getPlaylistItems({ playlistId, currentUserId, limit, page });

        return sendResponse(res, 200, {
            items,
            page,
            limit,
            totalItems: items.length,
            hasMore: items.length === limit,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Adds a specific track to a custom playlist for the authenticated user.
 *
 * @route   POST /api/playlists/:playlistId/items/:trackId
 * @desc    Adds a track to a specific playlist.
 * @access  VerifyToken (Requires valid Access Token)
 */
export const addTrackToPlaylist = async (
    req: TypedRequest<{ playlistId: PlaylistId; trackId: TrackId }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const playlistId = req.params.playlistId;
        const trackId = req.params.trackId;
        const userId = req.user!.id;

        const addedItem = await addTrackToPlaylistService({ playlistId, trackId, userId });
        return sendResponse(res, 201, addedItem);
    } catch (error) {
        next(error);
    }
};

/**
 * Removes a specific track from a custom playlist for the authenticated user.
 *
 * @route   DELETE /api/playlists/:playlistId/items/:trackId
 * @desc    Removes a track from a specific playlist.
 * @access  VerifyToken (Requires valid Access Token)
 */
export const removeTrackFromPlaylist = async (
    req: TypedRequest<{ playlistId: PlaylistId; trackId: TrackId }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const playlistId = req.params.playlistId;
        const trackId = req.params.trackId;
        const userId = req.user!.id;

        await removeTrackFromPlaylistService({ playlistId, trackId, userId });
        return sendResponse(res, 200, null, MESSAGES.SUCCESS.REMOVED_FROM_LIST);
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves detailed information for a specific playlist.
 *
 * @route   GET /api/playlists/:playlistId
 * @access  Public / Optional Auth
 */
export const getPlaylistById = async (
    req: TypedRequest<{ playlistId: PlaylistId }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const currentUserId = req.user?.id;
        const playlistId = req.params.playlistId;

        const playlist = await getPlaylistDetails({ playlistId, currentUserId });

        return sendResponse(res, 200, playlist);
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves interactions/comments for a specific playlist.
 *
 * @route   GET /api/playlists/:playlistId/interactions
 * @access  Public / Optional Auth
 */
export const getPlaylistInteractionsList = async (
    req: TypedRequest<{ playlistId: PlaylistId }, {}, Partial<PaginationQueries>>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const currentUserId = req.user?.id;
        const playlistId = req.params.playlistId;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 18;

        const interactions = await getPlaylistInteractions({ playlistId, currentUserId, limit, page });

        return sendResponse(res, 200, { items: interactions, page, limit, hasMore: interactions.length === limit });
    } catch (error) {
        next(error);
    }
};

/**
 * Creates or updates a user interaction (rating, comment, like) for a playlist.
 *
 * @route   POST /api/playlists/:playlistId/interactions
 * @access  VerifyToken
 */
export const createPlaylistInteraction = async (
    req: TypedRequest<{ playlistId: PlaylistId }, UpsertPlaylistInteractionDto>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const playlistId = req.params.playlistId;
        const userId = req.user!.id;
        const { rating, comment, isLiked } = req.body;

        const result = await upsertPlaylistInteraction({
            userId,
            playlistId,
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
 * Likes a specific playlist for the authenticated user.
 *
 * @route   POST /api/playlists/:playlistId/like
 * @access  VerifyToken
 */
export const likePlaylist = async (
    req: TypedRequest<{ playlistId: PlaylistId }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const playlistId = req.params.playlistId;
        const userId = req.user!.id;

        const result = await likePlaylistService({ userId, playlistId });

        return sendResponse(res, 200, result);
    } catch (error) {
        next(error);
    }
};

/**
 * Unlikes a specific playlist for the authenticated user.
 *
 * @route   DELETE /api/playlists/:playlistId/like
 * @access  VerifyToken
 */
export const unlikePlaylist = async (
    req: TypedRequest<{ playlistId: PlaylistId }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const playlistId = req.params.playlistId;
        const userId = req.user!.id;

        const result = await unlikePlaylistService({ userId, playlistId });

        return sendResponse(res, 200, result);
    } catch (error) {
        next(error);
    }
};

/**
 * Creates a new custom playlist for the authenticated user.
 *
 * @route   POST /v1/playlists
 * @access  Private (Requires Access Token)
 */
export const createPlaylistHandler = async (
    req: TypedRequestBody<Omit<CreatePlaylistDto, "creatorId">>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const { title, description, image, isPrivate } = req.body;
        const creatorId = req.user!.id as UserId;

        const newPlaylist = await createPlaylist({
            title,
            description,
            image,
            isPrivate,
            creatorId,
        });

        return sendResponse(res, 201, newPlaylist, MESSAGES.SUCCESS.CREATED_SUCCESSFULLY);
    } catch (error) {
        next(error);
    }
};

/**
 * Updates an existing custom playlist.
 *
 * @route   PATCH /v1/playlists/:playlistId
 * @access  Private (Requires Access Token)
 */
export const updatePlaylistHandler = async (
    req: TypedRequest<{ playlistId: PlaylistId }, Omit<UpdatePlaylistDto, "playlistId" | "userId">>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const playlistId = req.params.playlistId;
        const { title, description, image, isPrivate } = req.body;

        const updatedPlaylist = await updatePlaylist({
            playlistId,
            userId,
            title,
            description,
            image,
            isPrivate,
        });

        return sendResponse(res, 200, updatedPlaylist, MESSAGES.SUCCESS.UPDATED_SUCCESSFULLY);
    } catch (error) {
        next(error);
    }
};

/**
 * Deletes a custom playlist.
 *
 * @route   DELETE /v1/playlists/:playlistId
 * @access  Private (Requires Access Token)
 */
export const deletePlaylistHandler = async (
    req: TypedRequest<{ playlistId: PlaylistId }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id as UserId;
        const playlistId = req.params.playlistId;

        await deletePlaylist({ playlistId, userId });

        return sendResponse(res, 200, null, MESSAGES.SUCCESS.DELETED_SUCCESSFULLY);
    } catch (error) {
        next(error);
    }
};


