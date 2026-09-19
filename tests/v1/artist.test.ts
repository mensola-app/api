import request from "supertest";
import app from "@/app";
import { createTestUser } from "../helpers/auth.helper";
import { createTestArtistFollow } from "../helpers/db.helper";
import crypto from "crypto";

describe("Artist API", () => {
    let authToken: string;
    let userId: string;
    const testArtistSpotifyId = "4Z8W4fKeB5YxbusRsdQVPb"; // Example Spotify artist ID

    beforeAll(async () => {
        const { user, token } = await createTestUser();
        authToken = token;
        userId = user.id;
    });

    // ──────────────────────────────────────────────
    // POST /v1/artists/:id/follow
    // ──────────────────────────────────────────────
    describe("POST /v1/artists/:id/follow", () => {
        it("should follow an artist when authenticated", async () => {
            const response = await request(app)
                .post(`/v1/artists/${testArtistSpotifyId}/follow`)
                .set("Authorization", `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual({
                artistId: testArtistSpotifyId,
                isFollowing: true,
            });
        });

        it("should be idempotent — following again returns the same result", async () => {
            const response = await request(app)
                .post(`/v1/artists/${testArtistSpotifyId}/follow`)
                .set("Authorization", `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.isFollowing).toBe(true);
        });

        it("should return 401 when not authenticated", async () => {
            const response = await request(app)
                .post(`/v1/artists/${testArtistSpotifyId}/follow`);

            expect(response.status).toBe(401);
            expect(response.body.success).toBe(false);
        });
    });

    // ──────────────────────────────────────────────
    // DELETE /v1/artists/:id/follow
    // ──────────────────────────────────────────────
    describe("DELETE /v1/artists/:id/follow", () => {
        it("should unfollow a followed artist", async () => {
            // Ensure follow exists first
            await createTestArtistFollow(userId, testArtistSpotifyId);

            const response = await request(app)
                .delete(`/v1/artists/${testArtistSpotifyId}/follow`)
                .set("Authorization", `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual({
                artistId: testArtistSpotifyId,
                isFollowing: false,
            });
        });

        it("should be idempotent — unfollowing when not following returns the same result", async () => {
            const unfollowedArtistId = "6eUKZXaKkcviH0Ku9w2n3V";

            const response = await request(app)
                .delete(`/v1/artists/${unfollowedArtistId}/follow`)
                .set("Authorization", `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.isFollowing).toBe(false);
        });

        it("should return 401 when not authenticated", async () => {
            const response = await request(app)
                .delete(`/v1/artists/${testArtistSpotifyId}/follow`);

            expect(response.status).toBe(401);
            expect(response.body.success).toBe(false);
        });
    });

    // ──────────────────────────────────────────────
    // Short Link — Artist support
    // ──────────────────────────────────────────────
    describe("Short Link - Artist target type", () => {
        let shortLinkCode: string;

        it("should create a short link with targetType 'artist'", async () => {
            const response = await request(app)
                .post("/api/short-links")
                .send({
                    targetType: "artist",
                    targetId: testArtistSpotifyId,
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toHaveProperty("code");
            expect(response.body.data.code).toHaveLength(5);

            shortLinkCode = response.body.data.code;
        });

        it("should resolve the artist short link correctly", async () => {
            const response = await request(app)
                .get(`/api/short-links/${shortLinkCode}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.targetType).toBe("artist");
            expect(response.body.data.targetId).toBe(testArtistSpotifyId);
        });

        it("should return the same code when creating again for the same artist", async () => {
            const response = await request(app)
                .post("/api/short-links")
                .send({
                    targetType: "artist",
                    targetId: testArtistSpotifyId,
                });

            expect(response.status).toBe(200);
            expect(response.body.data.code).toBe(shortLinkCode);
        });

        it("should redirect to the correct artist URL", async () => {
            const response = await request(app)
                .get(`/${shortLinkCode}`);

            expect(response.status).toBe(302);
            expect(response.headers.location).toContain(`/artists/${testArtistSpotifyId}`);
        });
    });
});
