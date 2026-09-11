import request from "supertest";
import app from "@/app";

describe("Device Endpoints", () => {
    let userToken = "";
    let userId = "";
    let deviceId = "";

    const testUser = {
        email: "deviceuser@mensola.com",
        username: "deviceuser",
        password: "password123",
    };

    beforeAll(async () => {
        const regRes = await request(app).post("/v1/auth/register").send(testUser);
        userToken = regRes.body.data.accessToken;
        userId = regRes.body.data.user.id;
    });

    describe("POST /v1/devices", () => {
        it("should return 401 if unauthorized", async () => {
            const res = await request(app).post("/v1/devices").send({
                pushToken: "ExponentPushToken[test-token-1]",
                locale: "tr",
            });
            expect(res.status).toBe(401);
        });

        it("should successfully register a new device and return device id", async () => {
            const res = await request(app)
                .post("/v1/devices")
                .set("Authorization", `Bearer ${userToken}`)
                .send({
                    pushToken: "ExponentPushToken[test-token-1]",
                    locale: "tr",
                    platform: "ios",
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBeTruthy();
            deviceId = res.body.data.id;
        });

        it("should update device and owner on conflict (upsert)", async () => {
            const res = await request(app)
                .post("/v1/devices")
                .set("Authorization", `Bearer ${userToken}`)
                .send({
                    pushToken: "ExponentPushToken[test-token-1]",
                    locale: "en",
                    platform: "android",
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBe(deviceId);
        });
    });

    describe("PATCH /v1/devices/:id", () => {
        it("should update device locale", async () => {
            const res = await request(app)
                .patch(`/v1/devices/${deviceId}`)
                .set("Authorization", `Bearer ${userToken}`)
                .send({ locale: "en" });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.locale).toBe("en");
        });
    });

    describe("DELETE /v1/devices/:id", () => {
        it("should delete registered device", async () => {
            const res = await request(app)
                .delete(`/v1/devices/${deviceId}`)
                .set("Authorization", `Bearer ${userToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it("should return 404 when deleting an already deleted device", async () => {
            const res = await request(app)
                .delete(`/v1/devices/${deviceId}`)
                .set("Authorization", `Bearer ${userToken}`);

            expect(res.status).toBe(404);
        });
    });
});
