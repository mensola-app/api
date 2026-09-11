import request from "supertest";
import { MESSAGES } from "@/constants/messages";
import app from "@/app";
import pool from "@/config/db";

jest.mock("@/utils/email", () => ({
    sendEmailChangeVerificationCode: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
    sendBetaWaitlistEmail: jest.fn(),
}));

describe("User endpoints", () => {
    // Shared authentication tokens and user IDs for test suite setup
    let userAToken = "";
    let userAId = "";

    const userA = {
        email: "userA@mensola.com",
        username: "usernameA",
        password: "password123",
    };

    let userBId = "";
    let userBToken = "";

    const userB = {
        email: "userB@mensola.com",
        username: "usernameB",
        password: "password123",
    };

    let userCId = "";
    let userCToken = "";

    const userC = {
        email: "userC@mensola.com",
        username: "usernameC",
        password: "password123",
    };

    /**
     * Test Suite Setup
     * Registers three test users and seeds initial follow relationships to establish mutual/following states.
     */
    beforeAll(async () => {
        // Register User A
        const userAResponse = await request(app).post("/v1/auth/register").send(userA);
        userAId = userAResponse.body.data.user.id;
        userAToken = userAResponse.body.data.accessToken;

        // Register User B
        const userBResponse = await request(app).post("/v1/auth/register").send(userB);
        userBId = userBResponse.body.data.user.id;
        userBToken = userBResponse.body.data.accessToken;

        // Register User C
        const userCResponse = await request(app).post("/v1/auth/register").send(userC);
        userCId = userCResponse.body.data.user.id;
        userCToken = userCResponse.body.data.accessToken;

        // Seed social graph: User C follows User B, User A follows User C
        await request(app).post(`/v1/users/${userBId}/follow`).set("Authorization", `Bearer ${userCToken}`);
        await request(app).post(`/v1/users/${userCId}/follow`).set("Authorization", `Bearer ${userAToken}`);
    });

    /* ==========================================================================
       GET /v1/users/me Tests
       ========================================================================== */
    describe("GET /v1/users/me", () => {
        /**
         * @test Ensures authenticated users can retrieve their full profile with counts & arrays
         */
        it("should return authenticated user's own profile successfully and remove irrelevant relational fields (200)", async () => {
            const response = await request(app).get("/v1/users/me").set("Authorization", `Bearer ${userAToken}`);

            const profile = response.body.data?.profile;

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);

            expect(profile).toHaveProperty("id");
            expect(profile).toHaveProperty("username");
            expect(profile).toHaveProperty("fullname");
            expect(profile).toHaveProperty("bio");

            expect(typeof profile.movieListCount).toBe("number");
            expect(typeof profile.playlistCount).toBe("number");
            expect(typeof profile.watchlistMoviesCount).toBe("number");
            expect(typeof profile.watchedMoviesCount).toBe("number");
            expect(typeof profile.likedMoviesCount).toBe("number");
            expect(typeof profile.likedTracksCount).toBe("number");
            expect(typeof profile.likedPlaylistsCount).toBe("number");
            expect(typeof profile.likedMovieListsCount).toBe("number");
            expect(typeof profile.likedAlbumsCount).toBe("number");
            expect(typeof profile.followersCount).toBe("number");
            expect(typeof profile.followingCount).toBe("number");

            expect(Array.isArray(profile.favoriteMovies)).toBe(true);
            expect(Array.isArray(profile.favoriteTracks)).toBe(true);
        });

        /**
         * @test Ensures request fails with 403 when an invalid Bearer token is provided
         */
        it(" fail with 403 Unauthorized when an invalid or expired access token is provided (403)", async () => {
            const response = await request(app).get("/v1/users/me").set("Authorization", "Bearer invalid-token");

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_TOKEN);
        });
    });

    /* ==========================================================================
       GET /v1/users/:userId Tests
       ========================================================================== */
    describe("GET /v1/users/:userId", () => {
        /**
         * @test Validates public profile retrieval including relational fields (isFollowingByMe, mutualFollowers) for auth users
         */
        it("should return user profile with mutual followers and follow status for authenticated user (200)", async () => {
            const response = await request(app)
                .get(`/v1/users/${userBId}`)
                .set("Authorization", `Bearer ${userAToken}`);

            const profile = response.body.data?.profile;

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);

            expect(profile).toHaveProperty("id");
            expect(profile).toHaveProperty("username");
            expect(profile).toHaveProperty("fullname");
            expect(profile).toHaveProperty("bio");

            expect(typeof profile.movieListCount).toBe("number");
            expect(typeof profile.playlistCount).toBe("number");
            expect(typeof profile.watchlistMoviesCount).toBe("number");
            expect(typeof profile.watchedMoviesCount).toBe("number");
            expect(typeof profile.likedMoviesCount).toBe("number");
            expect(typeof profile.likedTracksCount).toBe("number");
            expect(typeof profile.likedPlaylistsCount).toBe("number");
            expect(typeof profile.likedMovieListsCount).toBe("number");
            expect(typeof profile.likedAlbumsCount).toBe("number");
            expect(typeof profile.followersCount).toBe("number");
            expect(typeof profile.followingCount).toBe("number");

            expect(typeof profile.isFollowingByMe).toBe("boolean");
            expect(Array.isArray(profile.mutualFollowers)).toBe(true);

            expect(Array.isArray(profile.favoriteMovies)).toBe(true);
            expect(Array.isArray(profile.favoriteTracks)).toBe(true);
        });

        /**
         * @test Validates guest user profile viewing (relational fields like mutualFollowers should be excluded/neutralized)
         */
        it("should return user profile without mutual followers and follow status for guest user (200)", async () => {
            const response = await request(app).get(`/v1/users/${userBId}`);

            const profile = response.body.data?.profile;

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);

            expect(profile).toHaveProperty("id");
            expect(profile).toHaveProperty("username");
            expect(profile).toHaveProperty("fullname");
            expect(profile).toHaveProperty("bio");

            expect(typeof profile.movieListCount).toBe("number");
            expect(typeof profile.playlistCount).toBe("number");
            expect(typeof profile.watchlistMoviesCount).toBe("number");
            expect(typeof profile.watchedMoviesCount).toBe("number");
            expect(typeof profile.likedMoviesCount).toBe("number");
            expect(typeof profile.likedTracksCount).toBe("number");
            expect(typeof profile.likedPlaylistsCount).toBe("number");
            expect(typeof profile.likedMovieListsCount).toBe("number");
            expect(typeof profile.likedAlbumsCount).toBe("number");
            expect(typeof profile.followersCount).toBe("number");
            expect(typeof profile.followingCount).toBe("number");

            expect(Array.isArray(profile.favoriteMovies)).toBe(true);
            expect(Array.isArray(profile.favoriteTracks)).toBe(true);
        });

        /**
         * @test Ensures request fails with 403 if an invalid token is explicitly provided
         */
        it("should return 403 error if token is sent but invalid or expired (403)", async () => {
            const response = await request(app)
                .get(`/v1/users/${userBId}`)
                .set("Authorization", "Bearer invalid-token");

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_TOKEN);
        });
    });

    /* ==========================================================================
       PUT /v1/users/me Tests
       ========================================================================== */
    describe("PUT /v1/users/me", () => {
        /**
         * @test Validates successful update of allowed profile fields (fullname, bio, avatar)
         */
        it("should update profile fields successfully and return only updated basic user data (200)", async () => {
            const updateData = {
                fullname: "Updated John Doe",
                bio: "This is my updated biography.",
                avatar: "https://example.com/avatar.jpg",
            };

            const response = await request(app)
                .patch("/v1/users/me")
                .set("Authorization", `Bearer ${userAToken}`)
                .send(updateData);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe(MESSAGES.SUCCESS.PROFILE_UPDATED);

            const updatedUser = response.body.data?.user;

            expect(updatedUser).toHaveProperty("id");
            expect(updatedUser).toHaveProperty("username");
            expect(updatedUser.fullname).toBe(updateData.fullname);
            expect(updatedUser.bio).toBe(updateData.bio);
            expect(updatedUser.avatar).toBe(updateData.avatar);
        });

        /**
         * @test Ensures Zod/Controller rejects empty request body updates with 400 Bad Request
         */
        it("should return 400 if request body is empty", async () => {
            const response = await request(app)
                .patch("/v1/users/me")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.AT_LEAST_ONE_FIELD_REQUIRED);
        });

        /**
         * @test Ensures unauthenticated users cannot update profile data
         */
        it("should fail with 403 Unauthorized when attempting to update profile without a valid token (403)", async () => {
            const response = await request(app)
                .patch("/v1/users/me")
                .set("Authorization", "Bearer invalid-token")
                .send({ fullname: "John Doe" });

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_TOKEN);
        });
    });

    /* ==========================================================================
       GET /v1/users/followers Tests
       ========================================================================== */
    describe("GET /v1/users/followers", () => {
        /**
         * @test Verifies followers list includes contextual 'isFollowing' flag when requested by auth user
         */
        it("should return followers list with isFollowing: true for authenticated user", async () => {
            const response = await request(app)
                .get("/v1/users/followers")
                .set("Authorization", `Bearer ${userAToken}`)
                .query({
                    userId: userBId,
                    limit: 20,
                    page: 1,
                });

            expect(response.body.success).toBe(true);

            const followers = response.body.data.items;

            expect(followers.length).toBe(1);
            expect(followers[0].isFollowing).toBe(true);
            expect(followers[0].isFollower).toBe(false);
            expect(followers[0].username).toBeTruthy();
        });

        /**
         * @test Verifies followers list sets 'isFollowing' to false when requested by guest
         */
        it("should return isFollowing as false for unauthenticated (guest) user", async () => {
            const response = await request(app).get("/v1/users/followers").query({
                userId: userBId,
                limit: 20,
                page: 1,
            });

            expect(response.body.success).toBe(true);

            const followers = response.body.data.items;

            expect(followers.length).toBe(1);
            expect(followers[0].isFollowing).toBe(false);
            expect(followers[0].isFollower).toBe(false);
            expect(followers[0].username).toBeTruthy();
        });

        /**
         * @test Verifies pagination calculation sets 'hasMore: true' when limit is met
         */
        it("should return hasMore: true when additional pages are available", async () => {
            const response = await request(app).get("/v1/users/followers").query({
                userId: userBId,
                limit: 1,
                page: 1,
            });

            expect(response.body.success).toBe(true);
            expect(response.body.data.hasMore).toBe(true);
        });

        /**
         * @test Ensures missing target userId query parameter returns 400 Bad Request
         */
        it("should return 400 when userId query parameter is missing", async () => {
            const response = await request(app).get("/v1/users/followers");

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_USER_ID);
        });
    });

    /* ==========================================================================
       GET /v1/users/following Tests
       ========================================================================== */
    describe("GET /v1/users/following", () => {
        /**
         * @test Verifies following list includes contextual 'isFollower' flag for auth user
         */
        it("should return following list with isFollower: true for authenticated user", async () => {
            const response = await request(app)
                .get("/v1/users/following")
                .set("Authorization", `Bearer ${userBToken}`)
                .query({
                    userId: userAId,
                    limit: 20,
                    page: 1,
                });

            expect(response.body.success).toBe(true);

            const following = response.body.data.items;

            expect(following.length).toBe(1);
            expect(following[0].isFollowing).toBe(false);
            expect(following[0].isFollower).toBe(true);
            expect(following[0].username).toBeTruthy();
        });

        /**
         * @test Verifies following list sets 'isFollower' to false for guest users
         */
        it("should return isFollower as false for unauthenticated (guest) user", async () => {
            const response = await request(app).get("/v1/users/following").query({
                userId: userAId,
                limit: 20,
                page: 1,
            });

            expect(response.body.success).toBe(true);

            const following = response.body.data.items;

            expect(following.length).toBe(1);
            expect(following[0].isFollowing).toBe(false);
            expect(following[0].isFollower).toBe(false);
            expect(following[0].username).toBeTruthy();
        });

        /**
         * @test Verifies pagination calculations for following list
         */
        it("should return hasMore: true when additional pages are available", async () => {
            const response = await request(app).get("/v1/users/following").query({
                userId: userAId,
                limit: 1,
                page: 1,
            });

            expect(response.body.success).toBe(true);
            expect(response.body.data.hasMore).toBe(true);
        });

        /**
         * @test Ensures missing target userId query parameter returns 400 Bad Request
         */
        it("should return 400 when userId query parameter is missing", async () => {
            const response = await request(app).get("/v1/users/following");

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_USER_ID);
        });
    });

    /* ==========================================================================
       POST /v1/users/:userId/follow Tests
       ========================================================================== */
    describe("POST /v1/users/:userId/follow", () => {
        /**
         * @test Verifies creating a new follow relationship (201 Created)
         */
        it("should allow a user to follow another user successfully (200)", async () => {
            const response = await request(app)
                .post(`/v1/users/${userAId}/follow`)
                .set("Authorization", `Bearer ${userBToken}`);

            expect(response.status).toBe(201);
            expect(response.body.success).toBe(true);
        });

        /**
         * @test Ensures idempotent behavior when trying to follow an already followed user
         */
        it("should handle duplicate follow requests gracefully (ON CONFLICT)", async () => {
            const response = await request(app)
                .post(`/v1/users/${userAId}/follow`)
                .set("Authorization", `Bearer ${userBToken}`);

            expect(response.status).toBe(201);
            expect(response.body.success).toBe(true);
        });

        /**
         * @test Ensures following a private user creates a pending follow request
         */
        it("should create a pending follow request when target user has private account (201)", async () => {
            // Update User A to private
            await request(app)
                .patch("/v1/users/privacy")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ isPrivate: true });

            // User C attempts to follow User A (User A is private)
            const response = await request(app)
                .post(`/v1/users/${userAId}/follow`)
                .set("Authorization", `Bearer ${userCToken}`);

            expect(response.status).toBe(201);
            expect(response.body.success).toBe(true);
            expect(response.body.data.status).toBe("pending");
            expect(response.body.data.isPending).toBe(true);
            expect(response.body.data.isFollowing).toBe(false);
            expect(response.body.message).toBe(MESSAGES.SUCCESS.FOLLOW_REQUEST_SENT);

            // Verify User A profile viewed by User C has isPendingByMe: true, isFollowingByMe: false, hasAccess: false
            const profileRes = await request(app)
                .get(`/v1/users/${userAId}`)
                .set("Authorization", `Bearer ${userCToken}`);

            expect(profileRes.body.data.profile.isPendingByMe).toBe(true);
            expect(profileRes.body.data.profile.isFollowingByMe).toBe(false);
            expect(profileRes.body.data.profile.hasAccess).toBe(false);

            // Revert User A privacy back to public
            await request(app)
                .patch("/v1/users/privacy")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ isPrivate: false });
        });

        /**
         * @test Ensures business logic prevents self-following (400 Bad Request)
         */
        it("should prevent a user from following themselves (400)", async () => {
            const response = await request(app)
                .post(`/v1/users/${userBId}/follow`)
                .set("Authorization", `Bearer ${userBToken}`);

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.CANNOT_FOLLOW_SELF);
        });

        /**
         * @test Ensures unauthenticated requests are rejected with 403 Forbidden
         */
        it("should return 403 Forbidden when no authentication token is provided", async () => {
            const response = await request(app)
                .post(`/v1/users/${userAId}/follow`)
                .set("Authorization", "Bearer invalid-token");

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_TOKEN);
        });
    });

    /* ==========================================================================
       DELETE /v1/users/:userId/follow Tests
       ========================================================================== */
    describe("DELETE /v1/users/:userId/follow", () => {
        /**
         * @test Verifies removing an existing follow relationship (200 OK)
         */
        it("should allow a user to unfollow someone they currently follow (200)", async () => {
            await request(app).post(`/v1/users/${userAId}/follow`).set("Authorization", `Bearer ${userBToken}`);

            const response = await request(app)
                .delete(`/v1/users/${userAId}/follow`)
                .set("Authorization", `Bearer ${userBToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        /**
         * @test Ensures unfollowing a non-followed user behaves idempotently (200 OK)
         */
        it("should handle unfollowing a user who is not being followed gracefully (Idempotent - 200)", async () => {
            const response = await request(app)
                .delete(`/v1/users/${userAId}/follow`)
                .set("Authorization", `Bearer ${userBToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        /**
         * @test Ensures business logic prevents self-unfollowing (400 Bad Request)
         */
        it("should prevent a user from unfollowing themselves (400)", async () => {
            const response = await request(app)
                .delete(`/v1/users/${userBId}/follow`)
                .set("Authorization", `Bearer ${userBToken}`);

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.CANNOT_UNFOLLOW_SELF);
        });

        /**
         * @test Ensures unauthenticated requests are rejected with 403 Forbidden
         */
        it("should return 403 Forbidden when no authentication token is provided", async () => {
            const response = await request(app)
                .delete(`/v1/users/${userAId}/follow`)
                .set("Authorization", "Bearer invalid-token");

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_TOKEN);
        });
    });

    describe("GET /v1/users/check-username", () => {
        /**
         * @test Validates that a taken username returns available: false
         */
        it("should return available: false if username is already taken", async () => {
            const response = await request(app)
                .get("/v1/users/check-username")
                .query({ username: "usernameA" });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.available).toBe(false);
        });

        /**
         * @test Validates that an available username returns available: true
         */
        it("should return available: true if username is free to use", async () => {
            const response = await request(app)
                .get("/v1/users/check-username")
                .query({ username: "usernamexyz" });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.available).toBe(true);
        });

        /**
         * @test Ensures validation schema rejects invalid formats (e.g., too short)
         */
        it("should return 400 validation error for invalid username formatting", async () => {
            const response = await request(app)
                .get("/v1/users/check-username")
                .query({ username: "ab" });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });
    });

    describe("PATCH /v1/users/username", () => {
        /**
         * @test Validates successful update of username and checks if usernameChangedAt is updated
         */
        it("should update username successfully and return 200", async () => {
            const response = await request(app)
                .patch("/v1/users/username")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ username: "newusernamea" });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe(MESSAGES.SUCCESS.USERNAME_UPDATED);
            expect(response.body.data.user.username).toBe("newusernamea");
            expect(response.body.data.user).toHaveProperty("usernameChangedAt");
        });

        /**
         * @test Ensures a user cannot change their username within 14 days
         */
        it("should return 400 if user attempts to change username within 14 days", async () => {
            const response = await request(app)
                .patch("/v1/users/username")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ username: "anotherusername" });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toContain("Kullanıcı adınızı 14 günde bir değiştirebilirsiniz");
        });

        /**
         * @test Ensures username must be unique (returns 400 if taken)
         */
        it("should return 400 if username is already taken by another user", async () => {
            const response = await request(app)
                .patch("/v1/users/username")
                .set("Authorization", `Bearer ${userBToken}`)
                .send({ username: "newusernamea" });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.USERNAME_ALREADY_TAKEN);
        });

        /**
         * @test Ensures invalid username format is rejected
         */
        it("should return 400 for invalid username formats", async () => {
            const response = await request(app)
                .patch("/v1/users/username")
                .set("Authorization", `Bearer ${userBToken}`)
                .send({ username: "ab" });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });

        /**
         * @test Ensures unauthenticated users are rejected
         */
        it("should return 403 Forbidden when no authorization token is provided", async () => {
            const response = await request(app)
                .patch("/v1/users/username")
                .set("Authorization", "Bearer invalid-token")
                .send({ username: "someusername" });

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_TOKEN);
        });

        /**
         * @test Ensures a pro/premium user can change their username without rate limits
         */
        it("should allow a non-free tier user to change their username multiple times within 14 days", async () => {
            // Update user A's subscriptionTier to 'pro' directly in the DB
            await pool.query('UPDATE "User" SET "subscriptionTier" = \'pro\' WHERE id = $1', [userAId]);

            const response = await request(app)
                .patch("/v1/users/username")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ username: "prousername" });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.user.username).toBe("prousername");

            // Clean up by changing subscriptionTier back to 'free'
            await pool.query('UPDATE "User" SET "subscriptionTier" = \'free\' WHERE id = $1', [userAId]);
        });
    });

    describe("POST /v1/users/email/request", () => {
        /**
         * @test Ensures unauthorized request returns 403
         */
        it("should return 403 if request is unauthorized", async () => {
            const response = await request(app)
                .post("/v1/users/email/request")
                .set("Authorization", "Bearer invalid-token")
                .send({ email: "newemail@mensola.com", password: "password123" });

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_TOKEN);
        });

        /**
         * @test Ensures incorrect password returns 401
         */
        it("should return 401 if password is wrong", async () => {
            const response = await request(app)
                .post("/v1/users/email/request")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ email: "newemail@mensola.com", password: "wrongpassword" });

            expect(response.status).toBe(401);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_CREDENTIALS);
        });

        /**
         * @test Ensures email validation schema rejects invalid formats
         */
        it("should return 400 validation error for invalid email formatting", async () => {
            const response = await request(app)
                .post("/v1/users/email/request")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ email: "invalid-email", password: "password123" });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });

        /**
         * @test Ensures email in use returns 400
         */
        it("should return 400 if email is already in use", async () => {
            const response = await request(app)
                .post("/v1/users/email/request")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ email: "userB@mensola.com", password: "password123" });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.EMAIL_ALREADY_TAKEN);
        });

        /**
         * @test Ensures successful verification code request saves OTP to database
         */
        it("should generate and store OTP code on successful request", async () => {
            const response = await request(app)
                .post("/v1/users/email/request")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ email: "newemail@mensola.com", password: "password123" });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe(MESSAGES.SUCCESS.EMAIL_CHANGE_CODE_SENT);

            // Directly query DB to check if OTP code is created
            const dbCheck = await pool.query(
                'SELECT code, "newEmail" FROM "EmailChangeVerification" WHERE "userId" = $1',
                [userAId]
            );
            expect(dbCheck.rowCount).toBe(1);
            expect(dbCheck.rows[0].newEmail).toBe("newemail@mensola.com");
            expect(dbCheck.rows[0].code).toHaveLength(6);
        });
    });

    describe("POST /v1/users/email/verify", () => {
        /**
         * @test Ensures unauthorized request returns 403
         */
        it("should return 403 if request is unauthorized", async () => {
            const response = await request(app)
                .post("/v1/users/email/verify")
                .set("Authorization", "Bearer invalid-token")
                .send({ email: "newemail@mensola.com", code: "123456" });

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_TOKEN);
        });

        /**
         * @test Ensures incorrect verification code returns 401
         */
        it("should return 401 if OTP code is incorrect", async () => {
            // First trigger request to ensure code exists
            await request(app)
                .post("/v1/users/email/request")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ email: "newemail@mensola.com", password: "password123" });

            const response = await request(app)
                .post("/v1/users/email/verify")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ email: "newemail@mensola.com", code: "000000" }); // wrong code

            expect(response.status).toBe(401);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_VERIFICATION_CODE);
        });

        /**
         * @test Ensures successful code verification updates user's email and cleans up verification table
         */
        it("should successfully verify OTP code and update user email in DB", async () => {
            // Trigger code request
            await request(app)
                .post("/v1/users/email/request")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ email: "newemail@mensola.com", password: "password123" });

            // Fetch the code from DB
            const dbCheck = await pool.query(
                'SELECT code FROM "EmailChangeVerification" WHERE "userId" = $1',
                [userAId]
            );
            const generatedCode = dbCheck.rows[0].code;

            // Submit correct code
            const response = await request(app)
                .post("/v1/users/email/verify")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ email: "newemail@mensola.com", code: generatedCode });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe(MESSAGES.SUCCESS.EMAIL_UPDATED);
            expect(response.body.data.user.email).toBe("newemail@mensola.com");

            // Verify email changed in User table
            const userCheck = await pool.query('SELECT email FROM "User" WHERE id = $1', [userAId]);
            expect(userCheck.rows[0].email).toBe("newemail@mensola.com");

            // Verify entry is deleted from verification table
            const verificationCheck = await pool.query(
                'SELECT 1 FROM "EmailChangeVerification" WHERE "userId" = $1',
                [userAId]
            );
            expect(verificationCheck.rowCount).toBe(0);

            // Clean up: restore original email so subsequent runs or other tests don't fail
            await pool.query('UPDATE "User" SET email = $1 WHERE id = $2', ["userA@mensola.com", userAId]);
        });
    });

    describe("PATCH /v1/users/password", () => {
        /**
         * @test Ensures unauthorized requests are blocked
         */
        it("should return 403 if request is unauthorized", async () => {
            const response = await request(app)
                .patch("/v1/users/password")
                .set("Authorization", "Bearer invalid-token")
                .send({ currentPassword: "password123", newPassword: "newpassword123" });

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_TOKEN);
        });

        /**
         * @test Ensures incorrect current password returns 401
         */
        it("should return 401 if current password is wrong", async () => {
            const response = await request(app)
                .patch("/v1/users/password")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ currentPassword: "wrongpassword", newPassword: "newpassword123" });

            expect(response.status).toBe(401);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INCORRECT_PASSWORD);
        });

        /**
         * @test Ensures short passwords are rejected
         */
        it("should return 400 validation error if new password is too short", async () => {
            const response = await request(app)
                .patch("/v1/users/password")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ currentPassword: "password123", newPassword: "123" });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });

        /**
         * @test Ensures successful password modification revokes other sessions and returns new token pair
         */
        it("should successfully update password, revoke all user sessions, and issue new tokens", async () => {
            // Seed a dummy secondary session in the Session table for user A
            await pool.query('INSERT INTO "Session" ("userId", "refreshToken") VALUES ($1, $2)', [userAId, "dummy-refresh-token"]);

            const response = await request(app)
                .patch("/v1/users/password")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ currentPassword: "password123", newPassword: "newpassword123" });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe(MESSAGES.SUCCESS.PASSWORD_CHANGED);
            expect(response.body.data).toHaveProperty("accessToken");
            expect(response.body.data).toHaveProperty("refreshToken");

            // Verify secondary session was revoked
            const sessionCheck = await pool.query('SELECT 1 FROM "Session" WHERE "userId" = $1 AND "refreshToken" = $2', [userAId, "dummy-refresh-token"]);
            expect(sessionCheck.rowCount).toBe(0);

            // Verify only the newly issued session exists in Session table
            const newSessionCheck = await pool.query('SELECT "refreshToken" FROM "Session" WHERE "userId" = $1', [userAId]);
            expect(newSessionCheck.rowCount).toBe(1);
            expect(newSessionCheck.rows[0].refreshToken).toBe(response.body.data.refreshToken);

            // Clean up: reset password back to 'password123' so other tests don't break
            const { hashPassword } = require("@/utils/hash");
            const resetHash = await hashPassword("password123");
            await pool.query('UPDATE "User" SET password = $1 WHERE id = $2', [resetHash, userAId]);
        });
    });

    describe("PATCH /v1/users/privacy", () => {
        /**
         * @test Ensures unauthorized requests are blocked
         */
        it("should return 403 if request is unauthorized", async () => {
            const response = await request(app)
                .patch("/v1/users/privacy")
                .set("Authorization", "Bearer invalid-token")
                .send({ isPrivate: true });

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_TOKEN);
        });

        /**
         * @test Ensures validation error is returned if isPrivate is missing or not a boolean
         */
        it("should return 400 validation error if isPrivate is missing", async () => {
            const response = await request(app)
                .patch("/v1/users/privacy")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });

        it("should return 400 validation error if isPrivate is not a boolean", async () => {
            const response = await request(app)
                .patch("/v1/users/privacy")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ isPrivate: "true" });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });

        /**
         * @test Ensures successful profile privacy update
         */
        it("should successfully update profile privacy status in DB", async () => {
            // Update to true
            let response = await request(app)
                .patch("/v1/users/privacy")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ isPrivate: true });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe(MESSAGES.SUCCESS.PRIVACY_UPDATED);
            expect(response.body.data.user.isPrivate).toBe(true);

            let dbCheck = await pool.query('SELECT "isPrivate" FROM "User" WHERE id = $1', [userAId]);
            expect(dbCheck.rows[0].isPrivate).toBe(true);

            // Revert back to false
            response = await request(app)
                .patch("/v1/users/privacy")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({ isPrivate: false });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.user.isPrivate).toBe(false);

            dbCheck = await pool.query('SELECT "isPrivate" FROM "User" WHERE id = $1', [userAId]);
            expect(dbCheck.rows[0].isPrivate).toBe(false);
        });
    });

    describe("DELETE /v1/users/me", () => {
        /**
         * @test Ensures unauthorized requests are blocked
         */
        it("should return 403 if request is unauthorized", async () => {
            const response = await request(app)
                .delete("/v1/users/me")
                .set("Authorization", "Bearer invalid-token");

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toBe(MESSAGES.ERRORS.INVALID_TOKEN);
        });

        /**
         * @test Ensures successful soft deletion of authenticated user
         */
        it("should successfully soft delete user account, clear sessions, and restrict profile lookups", async () => {
            // Register a temporary user to test deletion to avoid breaking subsequent tests that rely on userA
            const tempUser = {
                email: "tempdelete@mensola.com",
                username: "tempdeleteuser",
                password: "password123",
            };
            const registerRes = await request(app).post("/v1/auth/register").send(tempUser);
            const tempUserId = registerRes.body.data.user.id;
            const tempToken = registerRes.body.data.accessToken;

            // Seed a dummy session for the temp user
            await pool.query('INSERT INTO "Session" ("userId", "refreshToken") VALUES ($1, $2)', [tempUserId, "temp-refresh-token"]);

            // Soft delete user
            const response = await request(app)
                .delete("/v1/users/me")
                .set("Authorization", `Bearer ${tempToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe(MESSAGES.SUCCESS.ACCOUNT_DELETED);

            // Verify deletedAt is set in User table
            const dbCheck = await pool.query('SELECT "deletedAt" FROM "User" WHERE id = $1', [tempUserId]);
            expect(dbCheck.rows[0].deletedAt).not.toBeNull();

            // Verify dummy session is revoked
            const sessionCheck = await pool.query('SELECT 1 FROM "Session" WHERE "userId" = $1', [tempUserId]);
            expect(sessionCheck.rowCount).toBe(0);

            // Verify subsequent login attempts fail (401 Invalid Credentials)
            const loginRes = await request(app)
                .post("/v1/auth/login")
                .send({ email: tempUser.email, password: tempUser.password });
            expect(loginRes.status).toBe(401);
            expect(loginRes.body.success).toBe(false);

            // Verify subsequent profile details fetch fails (404)
            const profileRes = await request(app)
                .get(`/v1/users/${tempUserId}`)
                .set("Authorization", `Bearer ${userAToken}`);
            expect(profileRes.status).toBe(404);
            expect(profileRes.body.success).toBe(false);
        });
    });

    describe("Soft-deleted user account cleanup logic", () => {
        it("should permanently delete users soft-deleted 30+ days ago but keep those deleted less than 30 days ago", async () => {
            // Register three temporary users:
            // 1. Stale user: soft-deleted 31 days ago
            // 2. Fresh user: soft-deleted 10 days ago
            // 3. Active user: not deleted
            const staleUser = {
                email: "cleanup_stale@mensola.com",
                username: "cleanupstale",
                password: "password123",
            };
            const freshUser = {
                email: "cleanup_fresh@mensola.com",
                username: "cleanupfresh",
                password: "password123",
            };
            const activeUser = {
                email: "cleanup_active@mensola.com",
                username: "cleanupactive",
                password: "password123",
            };

            const res1 = await request(app).post("/v1/auth/register").send(staleUser);
            const res2 = await request(app).post("/v1/auth/register").send(freshUser);
            const res3 = await request(app).post("/v1/auth/register").send(activeUser);

            const staleId = res1.body.data.user.id;
            const freshId = res2.body.data.user.id;
            const activeId = res3.body.data.user.id;

            // Set deletedAt to 31 days ago for the stale user, and 10 days ago for the fresh user
            await pool.query(`UPDATE "User" SET "deletedAt" = NOW() - INTERVAL '31 days' WHERE id = $1`, [staleId]);
            await pool.query(`UPDATE "User" SET "deletedAt" = NOW() - INTERVAL '10 days' WHERE id = $1`, [freshId]);

            // Execute the cleanup query
            const deleteResult = await pool.query(`
                DELETE FROM "User"
                WHERE "deletedAt" IS NOT NULL AND "deletedAt" <= NOW() - INTERVAL '30 days';
            `);

            // Verify only 1 user (the stale one) was deleted
            expect(deleteResult.rowCount).toBe(1);

            // Verify stale user is permanently gone
            const staleCheck = await pool.query('SELECT 1 FROM "User" WHERE id = $1', [staleId]);
            expect(staleCheck.rowCount).toBe(0);

            // Verify fresh user still exists in the DB (soft-deleted state)
            const freshCheck = await pool.query('SELECT "deletedAt" FROM "User" WHERE id = $1', [freshId]);
            expect(freshCheck.rowCount).toBe(1);
            expect(freshCheck.rows[0].deletedAt).not.toBeNull();

            // Verify active user still exists in the DB (active state)
            const activeCheck = await pool.query('SELECT "deletedAt" FROM "User" WHERE id = $1', [activeId]);
            expect(activeCheck.rowCount).toBe(1);
            expect(activeCheck.rows[0].deletedAt).toBeNull();

            // Clean up: delete remaining temp users to leave database clean
            await pool.query('DELETE FROM "User" WHERE id IN ($1, $2)', [freshId, activeId]);
        });
    });

    describe("POST /v1/users/push-token", () => {
        it("should save a new push token for authenticated user (200)", async () => {
            const response = await request(app)
                .post("/v1/users/push-token")
                .set("Authorization", `Bearer ${userAToken}`)
                .send({
                    pushToken: "ExponentPushToken[userA-device-token]",
                    platform: "android",
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.pushToken).toBe("ExponentPushToken[userA-device-token]");
            expect(response.body.data.platform).toBe("android");
            expect(response.body.data.userId).toBe(userAId);
        });

        it("should upsert push token when the token already exists (200)", async () => {
            const response = await request(app)
                .post("/v1/users/push-token")
                .set("Authorization", `Bearer ${userBToken}`)
                .send({
                    pushToken: "ExponentPushToken[userA-device-token]",
                    platform: "ios",
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.pushToken).toBe("ExponentPushToken[userA-device-token]");
            expect(response.body.data.platform).toBe("ios");
            expect(response.body.data.userId).toBe(userBId);
        });

        it("should reject push token creation without authentication (401)", async () => {
            const response = await request(app)
                .post("/v1/users/push-token")
                .send({
                    pushToken: "ExponentPushToken[unauth-token]",
                    platform: "android",
                });

            expect(response.status).toBe(401);
            expect(response.body.success).toBe(false);
        });
    });
});
