import { Request, Response, NextFunction } from "express";
import {
    getNotificationsData,
    acceptFollowRequest,
    declineFollowRequest,
    markNotificationRead,
    markAllNotificationsRead,
} from "@/services/notification.service";
import { sendResponse } from "@/utils/response";
import { ApiError } from "@/utils/error";
import { UserId } from "@/types/common.types";

export const getNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError("UNAUTHORIZED", 401);
        }
        const data = await getNotificationsData(userId);
        sendResponse(res, 200, data);
    } catch (error) {
        next(error);
    }
};

export const handleAcceptFollowRequest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const currentUserId = req.user?.id;
        const { userId: requesterId } = req.params;
        if (!currentUserId) {
            throw new ApiError("UNAUTHORIZED", 401);
        }
        const data = await acceptFollowRequest(currentUserId, requesterId as UserId);
        sendResponse(res, 200, data, "Follow request accepted");
    } catch (error) {
        next(error);
    }
};

export const handleDeclineFollowRequest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const currentUserId = req.user?.id;
        const { userId: requesterId } = req.params;
        if (!currentUserId) {
            throw new ApiError("UNAUTHORIZED", 401);
        }
        const data = await declineFollowRequest(currentUserId, requesterId as UserId);
        sendResponse(res, 200, data, "Follow request declined");
    } catch (error) {
        next(error);
    }
};

export const handleMarkNotificationRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const userId = req.user?.id;
        const id = req.params.id as string;
        if (!userId) {
            throw new ApiError("UNAUTHORIZED", 401);
        }
        await markNotificationRead(userId, id);
        sendResponse(res, 200, null, "Notification marked as read");
    } catch (error) {
        next(error);
    }
};

export const handleMarkAllNotificationsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError("UNAUTHORIZED", 401);
        }
        await markAllNotificationsRead(userId);
        sendResponse(res, 200, null, "All notifications marked as read");
    } catch (error) {
        next(error);
    }
};
