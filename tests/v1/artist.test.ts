import request from "supertest";
import app from "@/app";
import pool from "@/config/db";
import { createTestUser } from "../helpers/auth.helper";
import { createTestArtistFollow, createTestArtist } from "../helpers/db.helper";
import crypto from "crypto";

// Mock Spotify service to avoid real API calls in tests
jest.mock("@/services/spotify.service", () => {
    const original = jest.requireActual("@/services/spotify.service");
    return {
        ...original,
        spotifyService: {
            ...original.spotifyService,
            getArtistBySpotifyId: jest.fn().mockResolvedValue({
                spotifyId: "4Z8W4fKeB5YxbusRsdQVPb",
                name: "Test Artist",
                image: "https://i.scdn.co/image/test",
                genres: ["pop", "dance pop"],
                followers: 50000000,
            }),
            getArtistTopTracks: jest.fn().mockResolvedValue([
                {
                    spotifyId: "track1",
                    title: "Hit Song",
                    duration: 210000,
                    image: "https://i.scdn.co/image/track1",
                    artists: [{ spotifyId: "4Z8W4fKeB5YxbusRsdQVPb", name: "Test Artist" }],
                    album: { spotifyId: "album1", title: "Great Album", image: "https://i.scdn.co/image/album1" },
                },
                {
                    spotifyId: "track2",
                    title: "Another Hit",
                    duration: 195000,
                    image: "https://i.scdn.co/image/track2",
                    artists: [{ spotifyId: "4Z8W4fKeB5YxbusRsdQVPb", name: "Test Artist" }],
                    album: { spotifyId: "album1", title: "Great Album", image: "https://i.scdn.co/image/album1" },
                },
            ]),
        },
    };
});

// Mock Redis cache to use in-memory store for tests
jest.mock("@/utils/cache", () => {
    const store = new Map<string, { data: string; expires: number }>();
    return {
        getOrSetCache: jest.fn(async <T>(key: string, ttl: number, fetchFn: () => Promise<T>): Promise<T> => {
            const cached = store.get(key);
            if (cached && cached.expires > Date.now()) {
                return JSON.parse(cached.data) as T;
            }
            const fresh = await fetchFn();
            store.set(key, { data: JSON.stringify(fresh), expires: Date.now() + ttl * 1000 });
            return fresh;
        }),
        setCache: jest.fn(async (key: string, data: any, ttl?: number) => {
            store.set(key, { data: JSON.stringify(data), expires: Date.now() + (ttl ?? 3600) * 1000 });
        }),
        getCache: jest.fn(async (key: string) => {
            const cached = store.get(key);
            if (cached && cached.expires > Date.now()) {
                return JSON.parse(cached.data);
            }
            return null;
        }),
        deleteCache: jest.fn(),
        deleteCachePattern: jest.fn(),
        invalidateUserProfile: jest.fn(),
    };
});

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
    // GET /v1/artists/:id
    // ──────────────────────────────────────────────
    describe("GET /v1/artists/:id", () => {
        it("should return artist details with top tracks when given a Spotify ID", async () => {
            const response = await request(app)
                .get(`/v1/artists/${testArtistSpotifyId}`)
                .set("Authorization", `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);

            const data = response.body.data;
            expect(data.spotifyId).toBe(testArtistSpotifyId);
            expect(data.name).toBe("Test Artist");
            expect(data).toHaveProperty("id"); // Internal DB UUID
            expect(data).toHaveProperty("followerCount");
            expect(typeof data.isFollowing).toBe("boolean");
            expect(Array.isArray(data.topTracks)).toBe(true);
            expect(data.topTracks.length).toBeGreaterThan(0);
            expect(data.topTracks[0]).toHaveProperty("spotifyId");
            expect(data.topTracks[0]).toHaveProperty("title");
            expect(data.topTracks[0]).toHaveProperty("duration");
        });

        it("should return artist details by internal DB UUID", async () => {
            // First, get the internal UUID from the previous test's upsert
            const dbResult = await pool.query(
                `SELECT id FROM "Artist" WHERE "spotifyId" = $1 LIMIT 1`,
                [testArtistSpotifyId],
            );
            const internalId = dbResult.rows[0].id;

            const response = await request(app)
                .get(`/v1/artists/${internalId}`)
                .set("Authorization", `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.id).toBe(internalId);
            expect(response.body.data.spotifyId).toBe(testArtistSpotifyId);
        });

        it("should return isFollowing=true when the user follows the artist", async () => {
            // Follow the artist first
            await request(app)
                .post(`/v1/artists/${testArtistSpotifyId}/follow`)
                .set("Authorization", `Bearer ${authToken}`);

            const response = await request(app)
                .get(`/v1/artists/${testArtistSpotifyId}`)
                .set("Authorization", `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data.isFollowing).toBe(true);
        });

        it("should return isFollowing=false when not authenticated", async () => {
            const response = await request(app)
                .get(`/v1/artists/${testArtistSpotifyId}`);

            expect(response.status).toBe(200);
            expect(response.body.data.isFollowing).toBe(false);
        });

        it("should return 404 for a non-existent DB UUID", async () => {
            const fakeUuid = crypto.randomUUID();
            const response = await request(app)
                .get(`/v1/artists/${fakeUuid}`);

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });

        it("should include genres and spotifyFollowers in response", async () => {
            const response = await request(app)
                .get(`/v1/artists/${testArtistSpotifyId}`);

            expect(response.status).toBe(200);
            const data = response.body.data;
            expect(Array.isArray(data.genres)).toBe(true);
            expect(typeof data.spotifyFollowers).toBe("number");
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
