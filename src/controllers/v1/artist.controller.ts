import { Request, Response, NextFunction } from "express";
import { followArtist, unfollowArtist, getArtistById, getArtistDiscography } from "@/services/artist.service";
import { sendResponse } from "@/utils/response";
import { TypedRequest } from "@/types/express.types";
import { MESSAGES } from "@/constants/messages";

/**
 * Retrieves detailed artist info including top tracks and follow status.
 *
 * @route   GET /v1/artists/:id
 * @access  Public / Optional Auth
 */
export const getArtistDetails = async (
    req: TypedRequest<{ id: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const id = req.params.id;
        const currentUserId = req.user?.id;

        const artist = await getArtistById(id, currentUserId);

        return sendResponse(res, 200, artist);
    } catch (error) {
        next(error);
    }
};

/**
 * Follows an artist by Spotify ID.
 *
 * @route   POST /v1/artists/:id/follow
 * @access  Private (verifyToken)
 */
export const followArtistHandler = async (
    req: TypedRequest<{ id: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const artistId = req.params.id;

        const result = await followArtist(userId, artistId);

        return sendResponse(res, 200, result, MESSAGES.SUCCESS.ARTIST_FOLLOWED);
    } catch (error) {
        next(error);
    }
};

/**
 * Unfollows an artist by Spotify ID.
 *
 * @route   DELETE /v1/artists/:id/follow
 * @access  Private (verifyToken)
 */
export const unfollowArtistHandler = async (
    req: TypedRequest<{ id: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const artistId = req.params.id;

        const result = await unfollowArtist(userId, artistId);

        return sendResponse(res, 200, result, MESSAGES.SUCCESS.ARTIST_UNFOLLOWED);
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves paginated discography (albums and singles) for an artist.
 *
 * @route   GET /v1/artists/:id/discography
 * @access  Public / Optional Auth
 */
export const getArtistDiscographyHandler = async (
    req: TypedRequest<{ id: string }, unknown, { page?: string; limit?: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const id = req.params.id;
        const page = req.query.page ? Number(req.query.page) : 1;
        const limit = req.query.limit ? Number(req.query.limit) : 10;

        const discography = await getArtistDiscography(id, page, limit);

        return sendResponse(res, 200, discography);
    } catch (error) {
        next(error);
    }
};

