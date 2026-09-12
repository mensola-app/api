import pool from "@/config/db";
import { notificationQueries } from "@/queries/notification.queries";
import { NotificationItem, NotificationsData, NotificationType } from "@/types/notification.types";
import { UserId } from "@/types/common.types";
import { ApiError } from "@/utils/error";
import { sendPushNotification } from "@/utils/pushNotification";
import { getMessages } from "@/constants/messages";

export interface CreateNotificationParams {
    recipientId: UserId | string;
    actorId: UserId | string;
    type: NotificationType;
    targetType?: string | null;
    targetId?: string | null;
    pushTitle?: string;
    pushBody?: string;
    localizedPush?: {
        tr?: { title: string; body: string };
        en?: { title: string; body: string };
        [locale: string]: { title: string; body: string } | undefined;
    };
    resolvePushContent?: (locale: string) => { title: string; body: string };
    path?: string;
    data?: Record<string, any>;
}

/**
 * Builds localized push notification title and body according to notification type and device locale.
 */
export const buildNotificationPushContent = (
    type: NotificationType,
    options: {
        actorName?: string;
        targetType?: string | null;
        targetTitle?: string;
        isAcceptedFollow?: boolean;
    },
    locale: string,
): { title: string; body: string } => {
    const msgs = getMessages(locale).NOTIFICATIONS;
    const actor = options.actorName || msgs.DEFAULT_ACTOR;

    if (type === "follow_request") {
        return {
            title: msgs.FOLLOW_REQUEST_TITLE,
            body: msgs.FOLLOW_REQUEST_BODY(actor),
        };
    }

    if (type === "follow") {
        if (options.isAcceptedFollow) {
            return {
                title: msgs.FOLLOW_ACCEPTED_TITLE,
                body: msgs.FOLLOW_ACCEPTED_BODY(actor),
            };
        }
        return {
            title: msgs.FOLLOW_TITLE,
            body: msgs.FOLLOW_BODY(actor),
        };
    }

    if (type === "like") {
        if (options.targetType === "playlist") {
            return {
                title: msgs.LIKE_TITLE,
                body: msgs.LIKE_PLAYLIST_BODY(actor, options.targetTitle),
            };
        }
        if (options.targetType === "movie_list") {
            return {
                title: msgs.LIKE_TITLE,
                body: msgs.LIKE_MOVIE_LIST_BODY(actor, options.targetTitle),
            };
        }
        if (options.targetType === "comment") {
            return {
                title: msgs.LIKE_TITLE,
                body: msgs.LIKE_COMMENT_BODY(actor),
            };
        }
    }

    return {
        title: msgs.LIKE_TITLE,
        body: `${actor}`,
    };
};

/**
 * Creates a notification record and sends an Expo push notification.
 */
export const createNotification = async (params: CreateNotificationParams): Promise<void> => {
    // Avoid sending notification to oneself
    if (params.recipientId === params.actorId) {
        return;
    }

    // Delete any existing identical notification to prevent duplication
    await pool.query(notificationQueries.deleteExisting, [
        params.recipientId,
        params.actorId,
        params.type,
        params.targetType ?? null,
        params.targetId ?? null,
    ]);

    // Insert new notification
    await pool.query(notificationQueries.create, [
        params.recipientId,
        params.actorId,
        params.type,
        params.targetType ?? null,
        params.targetId ?? null,
    ]);

    const hasPush = Boolean(
        params.resolvePushContent ||
        params.localizedPush ||
        (params.pushTitle && params.pushBody)
    );

    // If push notification content or resolver is provided, send push notification
    if (hasPush) {
        // Resolve default path for deep linking if not explicitly provided
        const resolvedPath =
            params.path ??
            (params.type === "follow_request"
                ? "/notifications"
                : params.type === "follow"
                  ? `/users/${params.actorId}`
                  : params.targetType === "playlist" && params.targetId
                    ? `/playlists/${params.targetId}`
                    : params.targetType === "movie_list" && params.targetId
                      ? `/movie-lists/${params.targetId}`
                      : params.targetType === "comment" && params.targetId
                        ? `/comments/${params.targetId}`
                        : undefined);

        await sendPushNotification(params.recipientId, {
            title: params.pushTitle,
            body: params.pushBody,
            localized: params.localizedPush,
            resolveContent: params.resolvePushContent,
            data: {
                type: params.type,
                actorId: params.actorId,
                targetType: params.targetType,
                targetId: params.targetId,
                ...(resolvedPath ? { path: resolvedPath } : {}),
                ...(params.data || {}),
            },
        });
    }
};

/**
 * Retrieves notifications for the user.
 * Returns both 'notifications' and 'followRequests' for backward compatibility.
 */
export const getNotificationsData = async (userId: UserId): Promise<NotificationsData> => {
    const result = await pool.query(notificationQueries.getAllByRecipient, [userId]);

    const notifications: NotificationItem[] = result.rows.map((row) => ({
        id: row.type === "follow_request" ? row.actorId : row.id,
        entityId: row.id,
        type: row.type as NotificationType,
        actor: {
            id: row.actorId,
            username: row.username,
            fullName: row.fullName,
            avatar: row.avatar,
        },
        target: row.targetId
            ? {
                  id: row.targetId,
                  type: (row.targetType || "user") as any,
                  title: row.targetTitle ?? undefined,
                  image: row.targetImage ?? undefined,
              }
            : undefined,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
        isRead: Boolean(row.isRead),
        status:
            row.type === "follow_request"
                ? row.followStatus === "accepted"
                    ? "accepted"
                    : row.followStatus === "pending"
                      ? "pending"
                      : "declined"
                : undefined,
    }));

    // Follow requests specifically for rows with type 'follow_request' that are pending
    const followRequests = notifications.filter(
        (n) => n.type === "follow_request" && n.status === "pending",
    );

    return {
        notifications,
        followRequests,
    };
};

/**
 * Accepts a follow request:
 * 1. Updates Follow status to 'accepted'.
 * 2. Removes the follow_request notification for the current user.
 * 3. Creates a 'follow' notification for the requester and sends push notification.
 */
export const acceptFollowRequest = async (currentUserId: UserId, requesterId: UserId) => {
    const result = await pool.query(notificationQueries.acceptFollowRequest, [requesterId, currentUserId]);
    if (result.rowCount === 0) {
        throw new ApiError("NOT_FOUND", 404, "Follow request not found or already handled");
    }

    // Remove the follow_request notification for current user
    await pool.query(notificationQueries.deleteFollowRequestNotification, [currentUserId, requesterId]);

    // Fetch current user details for the push notification
    const currentUserRes = await pool.query<{ username: string; fullname: string }>(
        `SELECT username, fullname FROM "User" WHERE id = $1`,
        [currentUserId],
    );
    const currentUser = currentUserRes.rows[0];
    const displayName = currentUser?.fullname || currentUser?.username;

    // Notify the requester that their follow request was accepted
    await createNotification({
        recipientId: requesterId,
        actorId: currentUserId,
        type: "follow",
        targetType: "user",
        targetId: currentUserId,
        resolvePushContent: (locale) =>
            buildNotificationPushContent(
                "follow",
                { actorName: displayName, isAcceptedFollow: true },
                locale,
            ),
        path: `/users/${currentUserId}`,
    });

    return { status: "accepted" as const };
};

/**
 * Declines a follow request:
 * 1. Deletes the pending Follow row.
 * 2. Deletes the follow_request notification.
 */
export const declineFollowRequest = async (currentUserId: UserId, requesterId: UserId) => {
    const result = await pool.query(notificationQueries.declineFollowRequest, [requesterId, currentUserId]);
    if (result.rowCount === 0) {
        throw new ApiError("NOT_FOUND", 404, "Follow request not found or already handled");
    }

    // Remove the follow_request notification
    await pool.query(notificationQueries.deleteFollowRequestNotification, [currentUserId, requesterId]);

    return { status: "declined" as const };
};

/**
 * Marks a single notification as read.
 */
export const markNotificationRead = async (userId: UserId, notificationId: string): Promise<void> => {
    await pool.query(notificationQueries.markAsRead, [notificationId, userId]);
};

/**
 * Marks all notifications for a user as read.
 */
export const markAllNotificationsRead = async (userId: UserId): Promise<void> => {
    await pool.query(notificationQueries.markAllAsRead, [userId]);
};
