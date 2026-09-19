import { Request, Response, NextFunction } from "express";
import { followArtist, unfollowArtist } from "@/services/artist.service";
import { sendResponse } from "@/utils/response";
import { TypedRequest } from "@/types/express.types";
import { MESSAGES } from "@/constants/messages";

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
