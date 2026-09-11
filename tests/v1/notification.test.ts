import request from "supertest";
import app from "@/app";
import pool from "@/config/db";

jest.mock("@/utils/email", () => ({
    sendEmailChangeVerificationCode: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
    sendBetaWaitlistEmail: jest.fn(),
}));

describe("Notification Endpoints", () => {
    let privateUserId = "";
    let privateUserToken = "";

    const privateUser = {
        email: "privateuser@mensola.com",
        username: "privateuser",
        password: "password123",
    };

    let requesterUserId = "";
    let requesterUserToken = "";

    const requesterUser = {
        email: "requester@mensola.com",
        username: "requesteruser",
        password: "password123",
    };

    beforeAll(async () => {
        // Register Private User
        const privRes = await request(app).post("/v1/auth/register").send(privateUser);
        privateUserId = privRes.body.data.user.id;
        privateUserToken = privRes.body.data.accessToken;

        // Set Private User account to private
        await request(app)
            .patch("/v1/users/privacy")
            .set("Authorization", `Bearer ${privateUserToken}`)
            .send({ isPrivate: true });

        // Register Requester User
        const reqRes = await request(app).post("/v1/auth/register").send(requesterUser);
        requesterUserId = reqRes.body.data.user.id;
        requesterUserToken = reqRes.body.data.accessToken;
    });

    describe("GET /v1/notifications", () => {
        it("should return 401 if unauthorized", async () => {
            const res = await request(app).get("/v1/notifications");
            expect(res.status).toBe(401);
        });

        it("should return empty followRequests list initially", async () => {
            const res = await request(app)
                .get("/v1/notifications")
                .set("Authorization", `Bearer ${privateUserToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.followRequests).toEqual([]);
        });

        it("should return pending follow request when someone requests to follow private user", async () => {
            // Requester sends follow request to private user
            const followRes = await request(app)
                .post(`/v1/users/${privateUserId}/follow`)
                .set("Authorization", `Bearer ${requesterUserToken}`);

            expect(followRes.status).toBe(201);
            expect(followRes.body.data.isPending).toBe(true);

            // Private user fetches notifications
            const notifRes = await request(app)
                .get("/v1/notifications")
                .set("Authorization", `Bearer ${privateUserToken}`);

            expect(notifRes.status).toBe(200);
            expect(notifRes.body.data.followRequests.length).toBe(1);
            expect(notifRes.body.data.followRequests[0].actor.id).toBe(requesterUserId);
            expect(notifRes.body.data.followRequests[0].type).toBe("follow_request");
            expect(notifRes.body.data.followRequests[0].status).toBe("pending");
        });
    });

    describe("POST /v1/users/follow-requests/:userId/accept", () => {
        it("should return 401 if unauthorized", async () => {
            const res = await request(app).post(`/v1/users/follow-requests/${requesterUserId}/accept`);
            expect(res.status).toBe(401);
        });

        it("should successfully accept a follow request via /v1/users/...", async () => {
            const res = await request(app)
                .post(`/v1/users/follow-requests/${requesterUserId}/accept`)
                .set("Authorization", `Bearer ${privateUserToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe("accepted");

            // Verify notifications list is now empty
            const notifRes = await request(app)
                .get("/v1/notifications")
                .set("Authorization", `Bearer ${privateUserToken}`);

            expect(notifRes.body.data.followRequests.length).toBe(0);
        });
    });

    describe("POST /v1/users/follow-requests/:userId/decline", () => {
        beforeAll(async () => {
            // Clean up and send another follow request
            await pool.query('DELETE FROM "Follow" WHERE "followerId" = $1 AND "followingId" = $2', [
                requesterUserId,
                privateUserId,
            ]);

            await request(app)
                .post(`/v1/users/${privateUserId}/follow`)
                .set("Authorization", `Bearer ${requesterUserToken}`);
        });

        it("should return 401 if unauthorized", async () => {
            const res = await request(app).post(`/v1/users/follow-requests/${requesterUserId}/decline`);
            expect(res.status).toBe(401);
        });

        it("should successfully decline a follow request via /v1/user/...", async () => {
            const res = await request(app)
                .post(`/v1/user/follow-requests/${requesterUserId}/decline`)
                .set("Authorization", `Bearer ${privateUserToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe("declined");

            // Verify notifications list is now empty
            const notifRes = await request(app)
                .get("/v1/notifications")
                .set("Authorization", `Bearer ${privateUserToken}`);

            expect(notifRes.body.data.followRequests.length).toBe(0);
        });
    });

    describe("PATCH /v1/notifications", () => {
        let testNotifId = "";

        beforeAll(async () => {
            // Requester follows private user again to generate a notification
            await request(app)
                .post(`/v1/users/${privateUserId}/follow`)
                .set("Authorization", `Bearer ${requesterUserToken}`);

            const notifRes = await request(app)
                .get("/v1/notifications")
                .set("Authorization", `Bearer ${privateUserToken}`);

            testNotifId = notifRes.body.data.notifications[0].id;
        });

        it("should mark a single notification as read", async () => {
            const res = await request(app)
                .patch(`/v1/notifications/${testNotifId}/read`)
                .set("Authorization", `Bearer ${privateUserToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const notifRes = await request(app)
                .get("/v1/notifications")
                .set("Authorization", `Bearer ${privateUserToken}`);

            const updated = notifRes.body.data.notifications.find((n: any) => n.id === testNotifId);
            expect(updated.isRead).toBe(true);
        });

        it("should mark all notifications as read", async () => {
            const res = await request(app)
                .patch("/v1/notifications/read-all")
                .set("Authorization", `Bearer ${privateUserToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const notifRes = await request(app)
                .get("/v1/notifications")
                .set("Authorization", `Bearer ${privateUserToken}`);

            const unread = notifRes.body.data.notifications.filter((n: any) => !n.isRead);
            expect(unread.length).toBe(0);
        });
    });

    describe("Like Notifications (Playlist & Movie List)", () => {
        it("should create a notification with target info when someone likes a playlist", async () => {
            // Private user creates a custom playlist
            const createPlRes = await request(app)
                .post("/v1/playlists")
                .set("Authorization", `Bearer ${privateUserToken}`)
                .send({ title: "My Special Playlist", isPrivate: false });

            expect(createPlRes.status).toBe(201);
            const playlistId = createPlRes.body.data.id;

            // Requester likes the playlist
            const likeRes = await request(app)
                .post(`/v1/playlists/${playlistId}/like`)
                .set("Authorization", `Bearer ${requesterUserToken}`);

            expect(likeRes.status).toBe(200);

            // Private user checks notifications
            const notifRes = await request(app)
                .get("/v1/notifications")
                .set("Authorization", `Bearer ${privateUserToken}`);

            const plNotif = notifRes.body.data.notifications.find(
                (n: any) => n.type === "like" && n.target?.type === "playlist" && n.target?.id === playlistId,
            );

            expect(plNotif).toBeTruthy();
            expect(plNotif.actor.id).toBe(requesterUserId);
            expect(plNotif.target.title).toBe("My Special Playlist");

            // Requester unlikes the playlist
            const unlikeRes = await request(app)
                .delete(`/v1/playlists/${playlistId}/like`)
                .set("Authorization", `Bearer ${requesterUserToken}`);

            expect(unlikeRes.status).toBe(200);

            // Notification should be deleted since it was unread
            const notifAfterUnlike = await request(app)
                .get("/v1/notifications")
                .set("Authorization", `Bearer ${privateUserToken}`);

            const notifStillExists = notifAfterUnlike.body.data.notifications.some(
                (n: any) => n.id === plNotif.id,
            );
            expect(notifStillExists).toBe(false);
        });

        it("should create a notification with target info when someone likes a movie list", async () => {
            // Private user creates a movie list
            const createListRes = await request(app)
                .post("/v1/movies/lists")
                .set("Authorization", `Bearer ${privateUserToken}`)
                .send({ title: "My Fav Sci-Fi Movies", isPrivate: false });

            expect(createListRes.status).toBe(201);
            const listId = createListRes.body.data.id;

            // Requester likes the movie list
            const likeRes = await request(app)
                .post(`/v1/movies/lists/${listId}/like`)
                .set("Authorization", `Bearer ${requesterUserToken}`);

            expect(likeRes.status).toBe(200);

            // Private user checks notifications
            const notifRes = await request(app)
                .get("/v1/notifications")
                .set("Authorization", `Bearer ${privateUserToken}`);

            const mlNotif = notifRes.body.data.notifications.find(
                (n: any) => n.type === "like" && n.target?.type === "movie_list" && n.target?.id === listId,
            );

            expect(mlNotif).toBeTruthy();
            expect(mlNotif.actor.id).toBe(requesterUserId);
            expect(mlNotif.target.title).toBe("My Fav Sci-Fi Movies");
        });
    });
});
