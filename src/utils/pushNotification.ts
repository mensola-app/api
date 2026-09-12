import pool from "@/config/db";
import { translateMessage } from "@/constants/messages";

export interface LocalizedContent {
    title: string;
    body: string;
}

export interface PushNotificationPayload {
    title?: string;
    body?: string;
    localized?: {
        tr?: LocalizedContent;
        en?: LocalizedContent;
        [locale: string]: LocalizedContent | undefined;
    };
    resolveContent?: (locale: string) => LocalizedContent;
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
 * Fetches active device push tokens and locales from the "UserDevices" table.
 *
 * @param recipientIds - Single user ID or array of user IDs
 * @param payload - Notification content (title, body, extra data, or localized resolvers)
 */
export const sendPushNotification = async (
    recipientIds: string | string[],
    payload: PushNotificationPayload,
): Promise<void> => {
    try {
        const ids = Array.isArray(recipientIds) ? recipientIds : [recipientIds];
        if (ids.length === 0) return;

        // Fetch tokens and locales for the given users
        const result = await pool.query<{ pushToken: string; locale: string | null }>(
            `SELECT "pushToken", "locale" FROM "UserDevices" WHERE "userId" = ANY($1::uuid[])`,
            [ids],
        );

        if (result.rows.length === 0) {
            return;
        }

        const messages: ExpoPushMessage[] = result.rows.map((row) => {
            const rawLocale = row.locale || "tr";
            const normalizedLocale = rawLocale.toLowerCase().startsWith("en") ? "en" : "tr";

            let title = payload.title || "";
            let body = payload.body || "";

            if (payload.resolveContent) {
                const resolved = payload.resolveContent(normalizedLocale);
                title = resolved.title;
                body = resolved.body;
            } else if (payload.localized && payload.localized[normalizedLocale]) {
                title = payload.localized[normalizedLocale]!.title;
                body = payload.localized[normalizedLocale]!.body;
            } else if (payload.localized && payload.localized.tr) {
                title = payload.localized.tr.title;
                body = payload.localized.tr.body;
            }

            // Fallback: If device is English, translate any remaining Turkish strings
            if (normalizedLocale === "en") {
                title = translateMessage(title, "en");
                body = translateMessage(body, "en");
            }

            return {
                to: row.pushToken,
                title,
                body,
                data: payload.data || {},
                sound: payload.sound ?? "default",
                badge: payload.badge,
            };
        });

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
