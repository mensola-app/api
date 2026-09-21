import request from "supertest";
import fs from "fs";
import path from "path";
import app from "@/app";
import { generateTestToken } from "../helpers/auth.helper";
import { parseSpotifyPlaylistId } from "@/utils/spotify.utils";
import { normalizeSpotifyTrack } from "@/services/spotifyImport.service";
import { importService } from "@/services/import.service";

// In-memory Redis store for tests
const redisStore = new Map<string, string>();

jest.mock("@/config/redis", () => ({
    redis: {
        get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
        set: jest.fn(async (key: string, value: string) => {
            redisStore.set(key, value);
            return "OK";
        }),
        del: jest.fn(async (...keys: string[]) => {
            keys.forEach((k) => redisStore.delete(k));
            return keys.length;
        }),
    },
}));

jest.mock("@/jobs/import.queue", () => ({
    importQueue: {
        add: jest.fn(async (name: string, data: any, opts: any) => ({
            id: opts?.jobId || "mock-job-id",
            name,
            data,
        })),
    },
    bullmqRedisConnection: {},
}));

describe("Spotify Import Pipeline", () => {
    let token: string;
    const testUserId = "550e8400-e29b-41d4-a716-446655440000";

    beforeAll(() => {
        token = generateTestToken(testUserId);
    });

    beforeEach(() => {
        redisStore.clear();
        jest.clearAllMocks();
    });

    describe("parseSpotifyPlaylistId", () => {
        it("should extract playlist ID from standard web URL with query params", () => {
            const url = "https://open.spotify.com/playlist/5XzIwoEzc7KWg250ua37Ew?si=test123456";
            expect(parseSpotifyPlaylistId(url)).toBe("5XzIwoEzc7KWg250ua37Ew");
        });

        it("should extract playlist ID from internationalized web URL", () => {
            const url = "https://open.spotify.com/intl-tr/playlist/5XzIwoEzc7KWg250ua37Ew?si=abc&pi=def";
            expect(parseSpotifyPlaylistId(url)).toBe("5XzIwoEzc7KWg250ua37Ew");
        });

        it("should extract playlist ID from spotify URI format", () => {
            const uri = "spotify:playlist:5XzIwoEzc7KWg250ua37Ew";
            expect(parseSpotifyPlaylistId(uri)).toBe("5XzIwoEzc7KWg250ua37Ew");
        });

        it("should accept raw 22-character playlist ID", () => {
            const rawId = "5XzIwoEzc7KWg250ua37Ew";
            expect(parseSpotifyPlaylistId(rawId)).toBe("5XzIwoEzc7KWg250ua37Ew");
        });

        it("should reject Spotify track URLs gracefully", () => {
            const trackUrl = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=xyz";
            expect(() => parseSpotifyPlaylistId(trackUrl)).toThrow();
            try {
                parseSpotifyPlaylistId(trackUrl);
            } catch (err: any) {
                expect(err.code).toBe("INPUT_IS_NOT_A_PLAYLIST");
            }
        });

        it("should reject Spotify album URLs gracefully", () => {
            const albumUrl = "https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT";
            expect(() => parseSpotifyPlaylistId(albumUrl)).toThrow();
            try {
                parseSpotifyPlaylistId(albumUrl);
            } catch (err: any) {
                expect(err.code).toBe("INPUT_IS_NOT_A_PLAYLIST");
            }
        });

        it("should reject Spotify artist URIs gracefully", () => {
            const artistUri = "spotify:artist:4cOdK2wGLETKBW3PvgPWqT";
            expect(() => parseSpotifyPlaylistId(artistUri)).toThrow();
            try {
                parseSpotifyPlaylistId(artistUri);
            } catch (err: any) {
                expect(err.code).toBe("INPUT_IS_NOT_A_PLAYLIST");
            }
        });

        it("should reject invalid URL or ID", () => {
            expect(() => parseSpotifyPlaylistId("invalid_playlist_link")).toThrow();
            try {
                parseSpotifyPlaylistId("invalid_playlist_link");
            } catch (err: any) {
                expect(err.code).toBe("INVALID_SPOTIFY_PLAYLIST_URL");
            }

            expect(() => parseSpotifyPlaylistId("")).toThrow();
            try {
                parseSpotifyPlaylistId("");
            } catch (err: any) {
                expect(err.code).toBe("INVALID_SPOTIFY_PLAYLIST_URL");
            }
        });
    });

    describe("normalizeSpotifyTrack", () => {
        it("should normalize track item with item.track format", () => {
            const rawItem = {
                added_at: "2026-09-10T14:28:00Z",
                is_local: false,
                track: {
                    id: "27cLyBuOudNfe6PffWlIze",
                    name: "İki Melek",
                    duration_ms: 220000,
                    artists: [{ id: "6wxh9aTFgTS4OiyYlnQBq6", name: "Bengü" }],
                    album: {
                        id: "5TQlrUZgHCqDSBqrd1xPDD",
                        name: "Gezegen",
                        release_date: "2008-06-27",
                        images: [{ url: "https://i.scdn.co/image/abc", width: 640, height: 640 }],
                    },
                },
            };

            const normalized = normalizeSpotifyTrack(rawItem);
            expect(normalized).not.toBeNull();
            expect(normalized?.spotifyId).toBe("27cLyBuOudNfe6PffWlIze");
            expect(normalized?.title).toBe("İki Melek");
            expect(normalized?.durationMs).toBe(220000);
            expect(normalized?.addedAt).toBe("2026-09-10T14:28:00Z");
            expect(normalized?.artists).toEqual([{ spotifyId: "6wxh9aTFgTS4OiyYlnQBq6", name: "Bengü" }]);
            expect(normalized?.album.spotifyId).toBe("5TQlrUZgHCqDSBqrd1xPDD");
            expect(normalized?.album.title).toBe("Gezegen");
            expect(normalized?.album.coverUrl).toBe("https://i.scdn.co/image/abc");
        });

        it("should normalize track item with item.item format (as seen in some Spotify endpoints)", () => {
            const rawItem = {
                added_at: "2026-09-10T14:28:00Z",
                is_local: false,
                item: {
                    id: "27cLyBuOudNfe6PffWlIze",
                    name: "İki Melek",
                    duration_ms: 220000,
                    artists: [{ id: "6wxh9aTFgTS4OiyYlnQBq6", name: "Bengü" }],
                    album: {
                        id: "5TQlrUZgHCqDSBqrd1xPDD",
                        name: "Gezegen",
                        images: [],
                    },
                },
            };

            const normalized = normalizeSpotifyTrack(rawItem);
            expect(normalized).not.toBeNull();
            expect(normalized?.spotifyId).toBe("27cLyBuOudNfe6PffWlIze");
            expect(normalized?.album.coverUrl).toBeNull(); // gracefully handles empty images array
        });

        it("should skip local or null files", () => {
            expect(normalizeSpotifyTrack(null)).toBeNull();
            expect(normalizeSpotifyTrack({ is_local: true, track: { id: "123" } })).toBeNull();
            expect(normalizeSpotifyTrack({ is_local: false, track: { is_local: true, id: "123" } })).toBeNull();
            expect(normalizeSpotifyTrack({ is_local: false, track: null })).toBeNull();
            expect(normalizeSpotifyTrack({ is_local: false, track: { id: "" } })).toBeNull();
        });
    });

    describe("Sample playlist.json parser verification", () => {
        it("should successfully parse tracks from example-import-spotify/playlist.json", () => {
            const samplePath = path.resolve(__dirname, "../../../../example-import-spotify/playlist.json");
            if (!fs.existsSync(samplePath)) {
                return; // Skip if file not found in environment
            }

            const rawJson = fs.readFileSync(samplePath, "utf-8");
            const data = JSON.parse(rawJson);

            expect(data.id).toBe("5XzIwoEzc7KWg250ua37Ew");
            expect(data.name).toBe("89.76-71.75-113");

            const container = data.tracks || data.items;
            expect(container).toBeDefined();
            expect(container.items.length).toBeGreaterThan(0);

            const normalizedTracks = container.items
                .map(normalizeSpotifyTrack)
                .filter(Boolean);

            expect(normalizedTracks.length).toBeGreaterThan(0);
            expect(normalizedTracks[0]?.spotifyId).toBeDefined();
            expect(normalizedTracks[0]?.title).toBeDefined();
            expect(normalizedTracks[0]?.album.title).toBeDefined();
            expect(normalizedTracks[0]?.artists.length).toBeGreaterThan(0);
        });
    });

    describe("POST /v1/imports/spotify Endpoint", () => {
        it("should reject requests without authorization token", async () => {
            const res = await request(app)
                .post("/v1/imports/spotify")
                .send({ urls: ["https://open.spotify.com/playlist/5XzIwoEzc7KWg250ua37Ew"] });

            expect(res.status).toBe(401);
        });

        it("should reject empty urls array", async () => {
            const res = await request(app)
                .post("/v1/imports/spotify")
                .set("Authorization", `Bearer ${token}`)
                .send({ urls: [] });

            expect(res.status).toBe(400);
        });

        it("should reject more than 10 playlist urls", async () => {
            const urls = Array(11).fill("https://open.spotify.com/playlist/5XzIwoEzc7KWg250ua37Ew");
            const res = await request(app)
                .post("/v1/imports/spotify")
                .set("Authorization", `Bearer ${token}`)
                .send({ urls });

            expect(res.status).toBe(400);
        });

        it("should reject track/album URLs in request body", async () => {
            const res = await request(app)
                .post("/v1/imports/spotify")
                .set("Authorization", `Bearer ${token}`)
                .send({ urls: ["https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT"] });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("INPUT_IS_NOT_A_PLAYLIST");
        });

        it("should successfully queue valid playlist URLs and return 202 Accepted", async () => {
            const res = await request(app)
                .post("/v1/imports/spotify")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    urls: [
                        "https://open.spotify.com/playlist/5XzIwoEzc7KWg250ua37Ew?si=abc123",
                        "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
                    ],
                });

            expect(res.status).toBe(202);
            expect(res.body.success).toBe(true);
            expect(res.body.data.jobId).toBeDefined();
            expect(res.body.data.status).toBe("queued");
            expect(res.body.data.totalItems).toBe(2);
            expect(res.body.data.type).toBe("spotify");

            // Verify progress was saved to Redis
            const savedProgress = await redisStore.get(`import:job:${res.body.data.jobId}`);
            expect(savedProgress).toBeDefined();
            const parsedProgress = JSON.parse(savedProgress!);
            expect(parsedProgress.type).toBe("spotify");
            expect(parsedProgress.totalItems).toBe(2);

            // Verify items payload was saved to Redis
            const savedPayload = await redisStore.get(`import:items:${res.body.data.jobId}`);
            expect(savedPayload).toBeDefined();
            const parsedPayload = JSON.parse(savedPayload!);
            expect(parsedPayload.playlistIds).toEqual([
                "5XzIwoEzc7KWg250ua37Ew",
                "37i9dQZF1DXcBWIGoYBM5M",
            ]);
        });

        it("should support a single string url and wrap it into an array", async () => {
            const res = await request(app)
                .post("/v1/imports/spotify")
                .set("Authorization", `Bearer ${token}`)
                .send({ urls: "5XzIwoEzc7KWg250ua37Ew" });

            expect(res.status).toBe(202);
            expect(res.body.data.totalItems).toBe(1);
        });
    });

    describe("GET /v1/imports/:jobId with Spotify Progress", () => {
        it("should retrieve the progress of a queued or processed Spotify import job", async () => {
            const createRes = await importService.createSpotifyImportJob(testUserId, [
                "https://open.spotify.com/playlist/5XzIwoEzc7KWg250ua37Ew",
            ]);

            const res = await request(app)
                .get(`/v1/imports/${createRes.jobId}`)
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.jobId).toBe(createRes.jobId);
            expect(res.body.data.type).toBe("spotify");
            expect(res.body.data.status).toBe("queued");
            expect(res.body.data.totalItems).toBe(1);
        });
    });
});
