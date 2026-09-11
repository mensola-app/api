import { UserId } from "./common.types";

export type NotificationType = "follow_request" | "follow" | "like" | "review" | "comment";

export interface INotification {
    id: string;
    recipientId: UserId;
    actorId: UserId;
    type: NotificationType;
    targetType?: string | null;
    targetId?: string | null;
    isRead: boolean;
    createdAt: Date | string;
}

export interface NotificationActor {
    id: UserId;
    username: string;
    fullName?: string;
    avatar?: string | null;
}

export interface NotificationTarget {
    id: string;
    type: "user" | "review" | "comment" | "movie_list" | "playlist";
    title?: string;
    image?: string | null;
}

export interface NotificationItem {
    id: string;
    type: NotificationType;
    actor: NotificationActor;
    message?: string;
    target?: NotificationTarget;
    createdAt: string;
    isRead: boolean;
    entityId?: string;
    status?: "pending" | "accepted" | "declined";
}

export type FollowRequestActor = NotificationActor;
export type FollowRequestNotification = NotificationItem;

export interface NotificationsData {
    notifications: NotificationItem[];
    followRequests: NotificationItem[];
}
