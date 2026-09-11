export const notificationQueries = {
    create: `
        INSERT INTO "Notification" ("recipientId", "actorId", "type", "targetType", "targetId", "createdAt")
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING *;
    `,

    deleteExisting: `
        DELETE FROM "Notification"
        WHERE "recipientId" = $1 AND "actorId" = $2 AND "type" = $3;
    `,

    getAllByRecipient: `
        SELECT 
            n."id",
            n."recipientId",
            n."actorId",
            n."type",
            n."targetType",
            n."targetId",
            n."isRead",
            n."createdAt",
            u.username,
            u.fullname AS "fullName",
            u.avatar,
            f.status AS "followStatus"
        FROM "Notification" n
        JOIN "User" u ON u.id = n."actorId"
        LEFT JOIN "Follow" f ON f."followerId" = n."actorId" AND f."followingId" = n."recipientId"
        WHERE n."recipientId" = $1
        ORDER BY n."createdAt" DESC
        LIMIT 50;
    `,

    markAsRead: `
        UPDATE "Notification"
        SET "isRead" = true
        WHERE ("id" = $1 OR "actorId" = $1) AND "recipientId" = $2
        RETURNING "id", "isRead";
    `,

    markAllAsRead: `
        UPDATE "Notification"
        SET "isRead" = true
        WHERE "recipientId" = $1 AND "isRead" = false;
    `,

    deleteFollowRequestNotification: `
        DELETE FROM "Notification"
        WHERE "recipientId" = $1 AND "actorId" = $2 AND "type" = 'follow_request';
    `,

    getPendingFollowRequests: `
        SELECT 
            f."followerId" AS "id",
            f."followedAt" AS "createdAt",
            u.id AS "actorId",
            u.username,
            u.fullname AS "fullName",
            u.avatar
        FROM "Follow" f
        JOIN "User" u ON u.id = f."followerId"
        WHERE f."followingId" = $1 AND f."status" = 'pending'
        ORDER BY f."followedAt" DESC;
    `,

    acceptFollowRequest: `
        UPDATE "Follow"
        SET "status" = 'accepted', "followedAt" = NOW()
        WHERE "followerId" = $1 AND "followingId" = $2 AND "status" = 'pending'
        RETURNING "followerId", "followingId", "status";
    `,

    declineFollowRequest: `
        DELETE FROM "Follow"
        WHERE "followerId" = $1 AND "followingId" = $2 AND "status" = 'pending'
        RETURNING "followerId", "followingId";
    `,
};
