import pool from "@/config/db";
import { sendPushNotification } from "@/utils/pushNotification";
import { buildNotificationPushContent } from "@/services/notification.service";

describe("Push Notification Localization", () => {
    describe("buildNotificationPushContent", () => {
        it("builds follow notification in TR and EN", () => {
            const tr = buildNotificationPushContent("follow", { actorName: "alice" }, "tr");
            expect(tr).toEqual({
                title: "Yeni Takipçi",
                body: "alice seni takip etmeye başladı.",
            });

            const en = buildNotificationPushContent("follow", { actorName: "alice" }, "en");
            expect(en).toEqual({
                title: "New Follower",
                body: "alice started following you.",
            });
        });

        it("uses default actor when actorName is missing", () => {
            const tr = buildNotificationPushContent("follow", {}, "tr");
            expect(tr.body).toBe("Bir kullanıcı seni takip etmeye başladı.");

            const en = buildNotificationPushContent("follow", {}, "en");
            expect(en.body).toBe("Someone started following you.");
        });

        it("builds follow_request notification in TR and EN", () => {
            const tr = buildNotificationPushContent("follow_request", { actorName: "bob" }, "tr");
            expect(tr).toEqual({
                title: "Yeni Takip İsteği",
                body: "bob sana takip isteği gönderdi.",
            });

            const en = buildNotificationPushContent("follow_request", { actorName: "bob" }, "en");
            expect(en).toEqual({
                title: "New Follow Request",
                body: "bob sent you a follow request.",
            });
        });

        it("builds follow accepted notification in TR and EN", () => {
            const tr = buildNotificationPushContent(
                "follow",
                { actorName: "carol", isAcceptedFollow: true },
                "tr",
            );
            expect(tr).toEqual({
                title: "Takip İsteğin Kabul Edildi",
                body: "carol takip isteğini kabul etti.",
            });

            const en = buildNotificationPushContent(
                "follow",
                { actorName: "carol", isAcceptedFollow: true },
                "en",
            );
            expect(en).toEqual({
                title: "Follow Request Accepted",
                body: "carol accepted your follow request.",
            });
        });

        it("builds like notifications for playlist, movie list, and comment in TR and EN", () => {
            // Comment
            const trComment = buildNotificationPushContent(
                "like",
                { actorName: "dave", targetType: "comment" },
                "tr",
            );
            expect(trComment).toEqual({
                title: "Yeni Beğeni",
                body: "dave yorumunu beğendi.",
            });

            const enComment = buildNotificationPushContent(
                "like",
                { actorName: "dave", targetType: "comment" },
                "en",
            );
            expect(enComment).toEqual({
                title: "New Like",
                body: "dave liked your comment.",
            });

            // Playlist
            const trPlaylist = buildNotificationPushContent(
                "like",
                { actorName: "dave", targetType: "playlist", targetTitle: "My Top 10" },
                "tr",
            );
            expect(trPlaylist.body).toBe('dave "My Top 10" çalma listeni beğendi.');

            const enPlaylist = buildNotificationPushContent(
                "like",
                { actorName: "dave", targetType: "playlist", targetTitle: "My Top 10" },
                "en",
            );
            expect(enPlaylist.body).toBe('dave liked your playlist "My Top 10".');

            // Movie list
            const trMovie = buildNotificationPushContent(
                "like",
                { actorName: "dave", targetType: "movie_list", targetTitle: "Sci-Fi Classics" },
                "tr",
            );
            expect(trMovie.body).toBe('dave "Sci-Fi Classics" film listeni beğendi.');

            const enMovie = buildNotificationPushContent(
                "like",
                { actorName: "dave", targetType: "movie_list", targetTitle: "Sci-Fi Classics" },
                "en",
            );
            expect(enMovie.body).toBe('dave liked your movie list "Sci-Fi Classics".');
        });
    });

    describe("sendPushNotification per-device localization", () => {
        let originalFetch: typeof global.fetch;

        beforeAll(() => {
            originalFetch = global.fetch;
        });

        afterAll(() => {
            global.fetch = originalFetch;
        });

        it("sends English notification to EN device and Turkish notification to TR device", async () => {
            const sentChunks: any[] = [];
            global.fetch = jest.fn().mockImplementation(async (_url: string, opts: any) => {
                sentChunks.push(JSON.parse(opts.body));
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ data: [{ status: "ok" }] }),
                } as any;
            });

            // Mock DB query to return 2 devices with different locales
            (jest.spyOn(pool, "query") as any).mockResolvedValueOnce({
                rows: [
                    { pushToken: "ExponentPushToken[tr-device]", locale: "tr" },
                    { pushToken: "ExponentPushToken[en-device]", locale: "en" },
                ],
                rowCount: 2,
            } as any);

            await sendPushNotification("user-123", {
                resolveContent: (locale) =>
                    buildNotificationPushContent("follow", { actorName: "alice" }, locale),
            });

            expect(sentChunks.length).toBe(1);
            const messages = sentChunks[0];
            expect(messages).toHaveLength(2);

            // TR Device
            expect(messages[0].to).toBe("ExponentPushToken[tr-device]");
            expect(messages[0].title).toBe("Yeni Takipçi");
            expect(messages[0].body).toBe("alice seni takip etmeye başladı.");

            // EN Device
            expect(messages[1].to).toBe("ExponentPushToken[en-device]");
            expect(messages[1].title).toBe("New Follower");
            expect(messages[1].body).toBe("alice started following you.");
        });

        it("translates raw Turkish push title and body for English devices as fallback", async () => {
            const sentChunks: any[] = [];
            global.fetch = jest.fn().mockImplementation(async (_url: string, opts: any) => {
                sentChunks.push(JSON.parse(opts.body));
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ data: [{ status: "ok" }] }),
                } as any;
            });

            (jest.spyOn(pool, "query") as any).mockResolvedValueOnce({
                rows: [{ pushToken: "ExponentPushToken[en-only]", locale: "en-US" }],
                rowCount: 1,
            } as any);

            await sendPushNotification("user-123", {
                title: "Yeni Takipçi",
                body: "john seni takip etmeye başladı.",
            });

            expect(sentChunks.length).toBe(1);
            const messages = sentChunks[0];
            expect(messages[0].title).toBe("New Follower");
            expect(messages[0].body).toBe("john started following you.");
        });
    });
});
