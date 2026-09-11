import pool from "@/config/db";

export interface PushNotificationPayload {
    title: string;
    body: string;
    data?: Record<string, any>;
    sound?: string;
    badge?: number;
}

interface ExpoPushMessage {
    to: string;
    title: string;
    body: string;
    data?: Record<string, any>;
    sound?: string;
    badge?: number;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Sends push notifications to one or more users via Expo Push Notification Service.
 * Fetches active device push tokens from the "UserDevices" table.
 *
 * @param recipientIds - Single user ID or array of user IDs
 * @param payload - Notification content (title, body, extra data)
 */
export const sendPushNotification = async (
    recipientIds: string | string[],
    payload: PushNotificationPayload,
): Promise<void> => {
    try {
        const ids = Array.isArray(recipientIds) ? recipientIds : [recipientIds];
        if (ids.length === 0) return;

        // Fetch tokens for the given users
        const result = await pool.query<{ pushToken: string }>(
            `SELECT "pushToken" FROM "UserDevices" WHERE "userId" = ANY($1::uuid[])`,
            [ids],
        );

        if (result.rows.length === 0) {
            return;
        }

        const messages: ExpoPushMessage[] = result.rows.map((row) => ({
            to: row.pushToken,
            title: payload.title,
            body: payload.body,
            data: payload.data || {},
            sound: payload.sound ?? "default",
            badge: payload.badge,
        }));

        // Expo allows up to 100 messages per chunk
        const chunkSize = 100;
        for (let i = 0; i < messages.length; i += chunkSize) {
            const chunk = messages.slice(i, i + chunkSize);

            try {
                const response = await fetch(EXPO_PUSH_URL, {
                    method: "POST",
                    headers: {
                        Accept: "application/json",
                        "Accept-Encoding": "gzip, deflate",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(chunk),
                });

                if (!response.ok) {
                    // Non-blocking log
                    console.error("Expo push notification returned error status:", response.status);
                }
            } catch (err) {
                // Non-blocking catch to prevent failure of business transaction
                console.error("Failed to send Expo push chunk:", err);
            }
        }
    } catch (error) {
        console.error("Error in sendPushNotification:", error);
    }
};
