import { Router } from "express";
import { verifyToken } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { userIdParamSchema } from "@/validations/user.validation";
import {
    getNotifications,
    handleAcceptFollowRequest,
    handleDeclineFollowRequest,
    handleMarkNotificationRead,
    handleMarkAllNotificationsRead,
} from "@/controllers/v1/notification.controller";

const router = Router();

router.use(verifyToken);

/**
 * @route   GET /api/v1/notifications
 * @desc    Get user notifications and pending follow requests
 * @access  Private (Requires valid Access Token)
 */
router.get("/", getNotifications);

/**
 * @route   PATCH /api/v1/notifications/read-all
 * @desc    Mark all user notifications as read
 * @access  Private (Requires valid Access Token)
 */
router.patch("/read-all", handleMarkAllNotificationsRead);

/**
 * @route   PATCH /api/v1/notifications/:id/read
 * @desc    Mark a specific notification as read
 * @access  Private (Requires valid Access Token)
 */
router.patch("/:id/read", handleMarkNotificationRead);

/**
 * @route   POST /api/v1/notifications/follow-requests/:userId/accept
 * @desc    Accept a pending follow request
 * @access  Private (Requires valid Access Token)
 */
router.post("/follow-requests/:userId/accept", validate(userIdParamSchema), handleAcceptFollowRequest);

/**
 * @route   POST /api/v1/notifications/follow-requests/:userId/decline
 * @desc    Decline a pending follow request
 * @access  Private (Requires valid Access Token)
 */
router.post("/follow-requests/:userId/decline", validate(userIdParamSchema), handleDeclineFollowRequest);

export default router;
