import { shortLinkService } from "@/services/shortLink.service";
import { TypedRequest, TypedRequestBody } from "@/types/express.types";
import { CreateShortLinkDto } from "@/types/shortLink.types";
import { sendResponse } from "@/utils/response";
import { NextFunction, Request, Response } from "express";

/**
 * Creates or retrieves a short link.
 *
 * @route   POST /api/short-links
 * @desc    Get existing short link or generate new 5-char code for target
 * @access  Public
 */
export const createShortLink = async (
    req: TypedRequestBody<CreateShortLinkDto>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const { targetType, targetId } = req.body;
        const result = await shortLinkService.createOrGetShortLink({ targetType, targetId });
        return sendResponse(res, 200, { code: result.code });
    } catch (error) {
        next(error);
    }
};

/**
 * Resolves target from short link code.
 *
 * @route   GET /api/short-links/:code
 * @desc    Find targetType and targetId by code
 * @access  Public
 */
export const getShortLink = async (
    req: TypedRequest<{ code: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const { code } = req.params;
        const result = await shortLinkService.getShortLinkByCode(code);
        return sendResponse(res, 200, result);
    } catch (error) {
        next(error);
    }
};

/**
 * Resolves short link and redirects HTTP 302 to destination web preview page.
 *
 * @route   GET /:code or GET /api/short-links/:code/redirect
 * @desc    Server-side 302 redirection
 * @access  Public
 */
export const redirectShortLink = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const code = String((req.params as any).code || req.params[0]);
        const result = await shortLinkService.getShortLinkByCode(code);

        const route =
            result.targetType === "movie_list"
                ? "movie-lists"
                : result.targetType === "user"
                  ? "users"
                  : "playlists";

        const webBaseUrl = process.env.WEB_URL || "https://mensola.app";
        const redirectUrl = `${webBaseUrl}/${route}/${result.targetId}`;

        return res.redirect(302, redirectUrl);
    } catch (error) {
        next(error);
    }
};
