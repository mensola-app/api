import request from "supertest";
import app from "@/app";
import crypto from "crypto";

describe("Short Link API", () => {
    const testTargetId = crypto.randomUUID();
    let generatedCode: string;

    describe("POST /api/short-links", () => {
        it("should create a 5-character short link for a target", async () => {
            const response = await request(app)
                .post("/api/short-links")
                .send({
                    targetType: "movie_list",
                    targetId: testTargetId,
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toHaveProperty("code");

            generatedCode = response.body.data.code;
            expect(generatedCode).toHaveLength(5);
            // Verify code contains NO ambiguous characters: 0, O, I, l
            expect(generatedCode).not.toMatch(/[0OIl]/);
        });

        it("should return the existing code when called again with the same target", async () => {
            const response = await request(app)
                .post("/api/short-links")
                .send({
                    targetType: "movie_list",
                    targetId: testTargetId,
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.code).toBe(generatedCode);
        });

        it("should reject invalid targetType", async () => {
            const response = await request(app)
                .post("/api/short-links")
                .send({
                    targetType: "invalid_type",
                    targetId: testTargetId,
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });

        it("should reject non-UUID targetId", async () => {
            const response = await request(app)
                .post("/api/short-links")
                .send({
                    targetType: "movie_list",
                    targetId: "not-a-uuid",
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });
    });

    describe("GET /api/short-links/:code", () => {
        it("should resolve target details for an existing code", async () => {
            const response = await request(app).get(`/api/short-links/${generatedCode}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.targetType).toBe("movie_list");
            expect(response.body.data.targetId).toBe(testTargetId);
        });

        it("should return 404 for a non-existent code", async () => {
            const response = await request(app).get("/api/short-links/zzzzz");

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });
    });

    describe("GET /:code direct redirection", () => {
        it("should return HTTP 302 redirecting to the target page", async () => {
            const response = await request(app).get(`/${generatedCode}`);

            expect(response.status).toBe(302);
            expect(response.headers.location).toContain(`/movie-lists/${testTargetId}`);
        });
    });
});
