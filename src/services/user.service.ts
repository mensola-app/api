import pool from "@/config/db";
import { ApiError } from "@/utils/error";
import { userQueries } from "@/queries/user.queries";
import { MESSAGES } from "@/constants/messages";
import {
    GetUserProfileDto,
    GetUserProfileResponse,
    ProfileUpdateDto,
    ProfileUpdateResponse,
    GetFollowersDto,
    GetFollowersResponseItem,
    GetFollowersResponse,
    GetFollowingDto,
    GetFollowingResponseItem,
    GetFollowingResponse,
    FollowDto,
    UnfollowDto,
    RequestEmailChangeDto,
    VerifyEmailChangeDto,
    ChangePasswordDto,
    ChangePasswordResponse,
    SearchUsersDto,
    SearchUsersResponse,
    SearchUsersResponseItem,
    SavePushTokenDto,
    IUserDevice,
} from "@/types/user.types";
import { deleteFileFromR2 } from "./storage.service";
import crypto from "crypto";
import { hashPassword, comparePassword } from "@/utils/hash";
import { sendEmailChangeVerificationCode } from "@/utils/email";
import { authQueries } from "@/queries/auth.queries";
import { generateAccessToken, generateRefreshToken } from "@/utils/jwt";

/**
 * Retrieves full user profile information along with statistics and mutual relationship details.
 * Converts raw PostgreSQL numeric counts to standard JavaScript numbers.
 *
 * @param dto - Contains targetUserId and optional viewerId
 * @returns Formatted user profile object
 * @throws ApiError (404) if the user profile does not exist
 */
export const getUserProfile = async (dto: GetUserProfileDto): Promise<GetUserProfileResponse> => {
    const result = await pool.query<GetUserProfileResponse>(userQueries.profile.get, [
        dto.targetUserId,
        dto.viewerId || null,
    ]);

    if (result.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    const rawData = result.rows[0];

    const profile: GetUserProfileResponse = {
        ...rawData,
        movieListCount: Number(rawData.movieListCount || 0),
        playlistCount: Number(rawData.playlistCount || 0),
        watchlistMoviesCount: Number(rawData.watchlistMoviesCount || 0),
        watchedMoviesCount: Number(rawData.watchedMoviesCount || 0),
        likedMoviesCount: Number(rawData.likedMoviesCount || 0),
        likedTracksCount: Number(rawData.likedTracksCount || 0),
        likedPlaylistsCount: Number(rawData.likedPlaylistsCount || 0),
        likedMovieListsCount: Number(rawData.likedMovieListsCount || 0),
        likedAlbumsCount: Number(rawData.likedAlbumsCount || 0),
        followersCount: Number(rawData.followersCount || 0),
        followingCount: Number(rawData.followingCount || 0),
    };

    // Remove personal relationship context if viewing own profile or visiting unauthenticated
    if (!dto.viewerId || dto.viewerId === dto.targetUserId) {
        delete profile.mutualFollowers;
        delete profile.isFollowingByMe;
        delete profile.isPendingByMe;
        delete profile.hasPendingRequestFromUser;
    }

    return profile;
};

/**
 * Dynamically updates profile fields (fullname, bio, avatar) for a specific user.
 *
 * @param dto - Contains userId and the fields to update
 * @returns Updated user profile subset
 * @throws ApiError (400) if no fields are provided for update
 * @throws ApiError (404) if the target user is not found
 */
export const profileUpdate = async (dto: ProfileUpdateDto): Promise<ProfileUpdateResponse> => {
    if (dto.updateData.avatar !== undefined) {
        const currentUserResult = await pool.query<{ avatar: string | null }>(userQueries.profile.getAvatarById, [
            dto.userId,
        ]);

        if (currentUserResult.rows.length === 0) {
            throw new ApiError("NOT_FOUND", 404);
        }

        const oldAvatarUrl = currentUserResult.rows[0].avatar;
        const newAvatarUrl = dto.updateData.avatar;

        if (oldAvatarUrl && oldAvatarUrl !== newAvatarUrl) {
            try {
                await deleteFileFromR2(oldAvatarUrl);
            } catch (err) {
                throw new ApiError("PROFILE_UPDATE_ERROR", 401);
            }
        }
    }

    const fields: string[] = [];
    const values: any[] = [];
    let placeholderIndex = 1;

    if (dto.updateData.fullname !== undefined) {
        fields.push(`"fullname" = $${placeholderIndex}`);
        values.push(dto.updateData.fullname);
        placeholderIndex++;
    }
    if (dto.updateData.bio !== undefined) {
        fields.push(`"bio" = $${placeholderIndex}`);
        values.push(dto.updateData.bio);
        placeholderIndex++;
    }
    if (dto.updateData.avatar !== undefined) {
        fields.push(`"avatar" = $${placeholderIndex}`);
        values.push(dto.updateData.avatar);
        placeholderIndex++;
    }

    if (fields.length === 0) {
        throw new ApiError("AT_LEAST_ONE_FIELD_REQUIRED", 400);
    }

    values.push(dto.userId);

    const query = userQueries.profile.update(fields, placeholderIndex);
    const result = await pool.query<ProfileUpdateResponse>(query, values);

    if (result.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    return result.rows[0];
};

/**
 * Retrieves a paginated list of followers for a given user.
 *
 * @param dto - Pagination settings, target user ID, and viewer context
 * @returns Array of follower items with follow status relative to viewer
 * @throws ApiError (400) if targetUserId is missing
 */
export const getFollowers = async (dto: GetFollowersDto): Promise<GetFollowersResponse> => {
    const offset = (dto.page - 1) * dto.limit;

    const result = await pool.query<GetFollowersResponseItem>(userQueries.relations.getFollowers, [
        dto.targetUserId,
        dto.viewerId || null,
        dto.limit,
        offset,
    ]);

    return result.rows;
};

/**
 * Retrieves a paginated list of users that the target user is following.
 *
 * @param dto - Pagination settings, target user ID, and viewer context
 * @returns Array of followed user items with follow status relative to viewer
 * @throws ApiError (400) if targetUserId is missing
 */
export const getFollowing = async (dto: GetFollowingDto): Promise<GetFollowingResponse> => {
    const offset = (dto.page - 1) * dto.limit;

    const result = await pool.query<GetFollowingResponseItem>(userQueries.relations.getFollowing, [
        dto.targetUserId,
        dto.viewerId || null,
        dto.limit,
        offset,
    ]);

    return result.rows;
};

/**
 * Creates a follow relationship between two users.
 *
 * @param dto - Contains followerId and followingId
 * @returns Boolean true indicating success
 * @throws ApiError (400) if a user attempts to follow themselves
 */
export const follow = async (
    dto: FollowDto,
): Promise<{ status: "pending" | "accepted"; isFollowing: boolean; isPending: boolean }> => {
    if (dto.followerId === dto.followingId) {
        throw new ApiError("CANNOT_FOLLOW_SELF", 400);
    }

    const targetUser = await pool.query<{ id: string; isPrivate: boolean }>(
        `SELECT id, "isPrivate" FROM "User" WHERE id = $1 AND "deletedAt" IS NULL`,
        [dto.followingId],
    );

    if (targetUser.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    const isPrivate = targetUser.rows[0].isPrivate ?? false;
    const status: "pending" | "accepted" = isPrivate ? "pending" : "accepted";

    await pool.query(userQueries.actions.follow, [dto.followerId, dto.followingId, status]);

    return {
        status,
        isFollowing: status === "accepted",
        isPending: status === "pending",
    };
};

/**
 * Removes a follow relationship between two users.
 *
 * @param dto - Contains followerId and followingId
 * @returns Boolean true indicating success
 * @throws ApiError (400) if a user attempts to unfollow themselves
 */
export const unfollow = async (dto: UnfollowDto): Promise<boolean> => {
    if (dto.followerId === dto.followingId) {
        throw new ApiError("CANNOT_UNFOLLOW_SELF", 400);
    }

    await pool.query(userQueries.actions.unfollow, [dto.followerId, dto.followingId]);

    return true;
};

/**
 * Updates the username of a user if within safety limits and not already taken.
 *
 * @param dto - Contains userId and the new username
 * @returns Updated user credentials object
 * @throws ApiError if limit checks fail or username is already taken
 */
export const updateUsername = async (dto: { userId: string; username: string }) => {
    // 1. Fetch current username, usernameChangedAt, and subscriptionTier
    const userResult = await pool.query<{
        username: string;
        usernameChangedAt: string | null;
        subscriptionTier: string;
    }>(userQueries.profile.getUsernameAndChangedAt, [dto.userId]);

    if (userResult.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    const { username: currentUsername, usernameChangedAt, subscriptionTier } = userResult.rows[0];

    // If it is the same username, do nothing
    if (currentUsername === dto.username) {
        return { username: currentUsername };
    }

    // 2. Check 14-day limit (Only applied for free tier accounts)
    if (subscriptionTier === "free" && usernameChangedAt) {
        const lastChanged = new Date(usernameChangedAt);
        const now = new Date();
        const diffMs = now.getTime() - lastChanged.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        if (diffDays < 14) {
            const remainingDays = Math.ceil(14 - diffDays);
            throw new ApiError("USERNAME_CHANGE_LIMIT", 400, MESSAGES.ERRORS.USERNAME_CHANGE_LIMIT(remainingDays));
        }
    }

    // 3. Check if new username is already taken
    const duplicateResult = await pool.query(userQueries.profile.existsByUsername, [dto.username, dto.userId]);

    if (duplicateResult.rows.length > 0) {
        throw new ApiError("USERNAME_ALREADY_TAKEN", 400);
    }

    // 4. Update the username and timestamp
    const updateResult = await pool.query<{ id: string; username: string; usernameChangedAt: Date }>(
        userQueries.profile.updateUsername,
        [dto.username, dto.userId],
    );

    return updateResult.rows[0];
};

/**
 * Checks the availability of a username in the database.
 *
 * @param username - The username to check
 * @returns Object indicating if the username is available
 */
export const checkUsernameAvailability = async (username: string): Promise<{ available: boolean }> => {
    const result = await pool.query<{ isTaken: boolean }>(userQueries.profile.checkUsername, [username]);
    const isTaken = result.rows[0]?.isTaken || false;
    return { available: !isTaken };
};

/**
 * Verifies current password and email uniqueness, generates a 6-digit OTP code,
 * saves it to the EmailChangeVerification table, and emails the code.
 */
export const requestEmailChange = async (dto: RequestEmailChangeDto): Promise<boolean> => {
    // 1. Get the current user's password hash
    const userRes = await pool.query<{ password: string }>(userQueries.emailChange.getPasswordHash, [dto.userId]);
    const user = userRes.rows[0];
    if (!user) {
        throw new ApiError("UNAUTHORIZED", 401);
    }

    // 2. Verify current password
    if (!dto.password) {
        throw new ApiError("MISSING_REQUIRED_FIELDS", 400);
    }
    const isPasswordValid = await comparePassword(dto.password, user.password);
    if (!isPasswordValid) {
        throw new ApiError("INVALID_CREDENTIALS", 401);
    }

    // 3. Verify new email is not in use
    const emailCheck = await pool.query(userQueries.emailChange.existsByEmail, [dto.email]);
    if (emailCheck.rowCount && emailCheck.rowCount > 0) {
        throw new ApiError("EMAIL_ALREADY_TAKEN", 400);
    }

    // 4. Generate 6-digit verification code
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // 5. Store in database
    await pool.query(userQueries.emailChange.upsertVerification, [dto.userId, dto.email, code, expiresAt]);

    // 6. Send verification email
    await sendEmailChangeVerificationCode(dto.email, code);

    return true;
};

/**
 * Verifies the 6-digit OTP code against the database, updates the user's email address,
 * and deletes the verification record.
 */
export const verifyEmailChange = async (
    dto: VerifyEmailChangeDto,
): Promise<{ id: string; email: string; username: string }> => {
    // 1. Retrieve the verification record
    const verificationRes = await pool.query<{ newEmail: string; code: string; expiresAt: Date }>(
        userQueries.emailChange.getVerification,
        [dto.userId],
    );
    const verification = verificationRes.rows[0];

    if (!verification) {
        throw new ApiError("INVALID_VERIFICATION_CODE", 401);
    }

    // 2. Validate code and expiration
    const isExpired = new Date(verification.expiresAt).getTime() < Date.now();
    if (verification.code !== dto.code || verification.newEmail !== dto.email || isExpired) {
        throw new ApiError("INVALID_VERIFICATION_CODE", 401);
    }

    // 3. Update the user's email address
    const updateRes = await pool.query<{ id: string; email: string; username: string }>(
        userQueries.emailChange.updateEmail,
        [dto.email, dto.userId],
    );

    // 4. Delete the verification record
    await pool.query(userQueries.emailChange.deleteVerification, [dto.userId]);

    return updateRes.rows[0];
};

/**
 * Changes user password:
 * 1. Checks current password.
 * 2. Hashes new password.
 * 3. Updates password in DB.
 * 4. Revokes all current sessions.
 * 5. Generates new tokens.
 * 6. Creates new session entry in DB.
 */
export const changePassword = async (dto: ChangePasswordDto): Promise<ChangePasswordResponse> => {
    // 1. Get current password hash
    const userRes = await pool.query<{ password: string }>(userQueries.emailChange.getPasswordHash, [dto.userId]);
    const user = userRes.rows[0];
    if (!user) {
        throw new ApiError("UNAUTHORIZED", 401);
    }

    // 2. Validate current password
    if (!dto.currentPassword || !dto.newPassword) {
        throw new ApiError("MISSING_REQUIRED_FIELDS", 400);
    }
    const isPasswordValid = await comparePassword(dto.currentPassword, user.password);
    if (!isPasswordValid) {
        throw new ApiError("INCORRECT_PASSWORD", 401);
    }

    // 3. Hash and update new password
    const hashedNewPassword = await hashPassword(dto.newPassword);
    await pool.query(userQueries.password.update, [hashedNewPassword, dto.userId]);

    // 4. Revoke all active sessions
    await pool.query(authQueries.session.deleteByUserId, [dto.userId]);

    // 5. Generate new access and refresh tokens
    const accessToken = generateAccessToken(dto.userId);
    const refreshToken = generateRefreshToken(dto.userId);

    // 6. Create new active session entry
    await pool.query(authQueries.session.create, [dto.userId, refreshToken]);

    return { accessToken, refreshToken };
};

/**
 * Updates profile privacy status (isPrivate) in the database.
 */
export const updateProfilePrivacy = async (
    userId: string,
    isPrivate: boolean,
): Promise<{ id: string; email: string; username: string; isPrivate: boolean }> => {
    const result = await pool.query<{ id: string; email: string; username: string; isPrivate: boolean }>(
        userQueries.privacy.update,
        [isPrivate, userId],
    );

    if (result.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    return result.rows[0];
};

/**
 * Soft deletes user account:
 * 1. Sets deletedAt = NOW() in User table.
 * 2. Revokes all active user sessions from Session table.
 */
export const softDeleteAccount = async (userId: string): Promise<void> => {
    // 1. Soft delete the user
    const result = await pool.query(userQueries.profile.softDelete, [userId]);
    if (result.rowCount === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    // 2. Revoke all active sessions
    await pool.query(authQueries.session.deleteByUserId, [userId]);
};

/**
 * Searches users by username or fullname using trigram similarity.
 *
 * @param dto - Pagination settings, search query, and viewer context
 * @returns Array of matching users
 */
export const searchUsers = async (dto: SearchUsersDto): Promise<SearchUsersResponse> => {
    const offset = (dto.page - 1) * dto.limit;

    const result = await pool.query<SearchUsersResponseItem>(userQueries.search.byQuery, [
        dto.query,
        dto.viewerId || null,
        dto.limit,
        offset,
    ]);

    return result.rows;
};

/**
 * Upserts a push notification token for a user device.
 * If the pushToken already exists, updates userId, platform, and updatedAt.
 */
export const savePushToken = async (dto: SavePushTokenDto): Promise<IUserDevice> => {
    const result = await pool.query<IUserDevice>(userQueries.devices.upsert, [
        dto.userId,
        dto.pushToken,
        dto.platform,
    ]);
    return result.rows[0];
};

/**
 * Removes a device push token by userId and pushToken.
 */
export const removeUserDevice = async (userId: string, pushToken: string): Promise<boolean> => {
    await pool.query(userQueries.devices.deleteByUserAndToken, [userId, pushToken]);
    return true;
};
