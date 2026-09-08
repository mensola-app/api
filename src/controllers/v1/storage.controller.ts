import { Request, Response, NextFunction } from "express";
import { uploadAvatarToR2, uploadCoverToR2 } from "@/services/storage.service";
import { ApiError } from "@/utils/error";
import { sendResponse } from "@/utils/response";

export const uploadAvatar = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) return next(new ApiError("INVALID_USER_ID"));

    try {
        if (!req.file) return next(new ApiError("IMAGE_UPLOAD_ERROR"));
        const avatarUrl = await uploadAvatarToR2(req.file, userId);

        sendResponse(res, 201, { avatarUrl });
    } catch (error) {
        next(new ApiError("IMAGE_UPLOAD_ERROR"));
    }
};

export const uploadCover = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) return next(new ApiError("INVALID_USER_ID"));

    try {
        if (!req.file) return next(new ApiError("IMAGE_UPLOAD_ERROR"));
        const imageUrl = await uploadCoverToR2(req.file, userId);

        sendResponse(res, 201, { imageUrl, coverUrl: imageUrl });
    } catch (error) {
        next(new ApiError("IMAGE_UPLOAD_ERROR"));
    }
};

