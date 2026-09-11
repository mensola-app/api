import crypto from "crypto";
import pool from "@/config/db";

import { ApiError } from "@/utils/error";
import { sendPasswordResetEmail } from "@/utils/email";
import { hashPassword, comparePassword } from "@/utils/hash";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "@/utils/jwt";
import { verifyGoogleToken } from "@/utils/google";

import { authQueries } from "@/queries/auth.queries";
import { userQueries } from "@/queries/user.queries";
import { MESSAGES } from "@/constants/messages";

import {
    CreateUserDto,
    LoginUserDto,
    TokenRefreshDto,
    LogoutDto,
    SendResetEmailDto,
    VerifyCodeDto,
    UpdatePasswordDto,
    GoogleAuthDto,
    CreateUserResponse,
    LoginUserResponse,
    TokenRefreshResponse,
    VerifyCodeResponse,
    GoogleAuthResponse,
} from "@/types/auth.types";
import { IUser, ISession } from "@/types/user.types";

/*
 * Register a new user, hashes their password, and creates an initial session
 */
export const createUser = async (dto: CreateUserDto): Promise<CreateUserResponse> => {
    const hashedPassword = await hashPassword(dto.password);

    const values = [dto.email, dto.username, hashedPassword];
    const result = await pool.query<IUser>(authQueries.user.create, values);

    const newUser = result.rows[0];

    const accessToken = generateAccessToken(newUser.id);
    const refreshToken = generateRefreshToken(newUser.id);

    // Save refresh token to session table
    await pool.query(authQueries.session.create, [newUser.id, refreshToken]);

    return { user: newUser, accessToken, refreshToken };
};

/*
 * Authenticates user credentials and generates access & refresh tokens
 */
export const loginUser = async (dto: LoginUserDto): Promise<LoginUserResponse> => {
    // Fetch user with password
    const result = await pool.query<IUser & { password: string }>(authQueries.user.findByEmail, [dto.email]);

    const dbUser = result.rows[0];
    if (!dbUser) {
        throw new ApiError("INVALID_CREDENTIALS", 401);
    }

    // Separate password from user object before returning
    const { password, ...user } = dbUser;

    if (!password) {
        const oauthResult = await pool.query<{ provider: string }>(authQueries.oauth.findProvidersByUserId, [user.id]);
        const provider = oauthResult.rows[0]?.provider || "google";
        const formattedProvider = provider.charAt(0).toUpperCase() + provider.slice(1);

        throw new ApiError(
            "OAUTH_ACCOUNT_NO_PASSWORD",
            400,
            MESSAGES.ERRORS.OAUTH_ACCOUNT_NO_PASSWORD(formattedProvider),
        );
    }

    const isValid = await comparePassword(dto.password, password);
    if (!isValid) {
        throw new ApiError("INVALID_CREDENTIALS", 401);
    }

    if (dbUser.deletedAt) {
        throw new ApiError("ACCOUNT_SOFT_DELETED", 401);
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Create session entry in database
    await pool.query(authQueries.session.create, [user.id, refreshToken]);

    return { user, accessToken, refreshToken };
};

/*
 * Validates existing refresh token and issues a new access token.
 */
export const tokenRefresh = async (dto: TokenRefreshDto): Promise<TokenRefreshResponse> => {
    // Verify JWT payload
    let decoded: { id: string };
    try {
        decoded = verifyRefreshToken(dto.refreshToken) as { id: string };
    } catch (error) {
        throw new ApiError("INVALID_REFRESH_TOKEN", 401);
    }

    // Check if session exists in DB
    const result = await pool.query<ISession>(authQueries.session.getByToken, [dto.refreshToken]);
    const session = result.rows[0];
    if (!session) {
        throw new ApiError("INVALID_REFRESH_TOKEN", 401);
    }

    const newAccessToken = generateAccessToken(decoded.id);

    return { accessToken: newAccessToken };
};

/**
 * Revokes a session by deleting the refresh token from the database.
 * If a pushToken is provided, removes that device entry for the user.
 */
export const userLogout = async (dto: LogoutDto, userId?: string): Promise<boolean> => {
    let resolvedUserId = userId;

    if (!resolvedUserId && dto.refreshToken) {
        const sessionRes = await pool.query<{ userId: string }>(authQueries.session.getByToken, [dto.refreshToken]);
        if (sessionRes.rows[0]) {
            resolvedUserId = sessionRes.rows[0].userId;
        }
    }

    if (dto.pushToken) {
        if (resolvedUserId) {
            await pool.query(userQueries.devices.deleteByUserAndToken, [resolvedUserId, dto.pushToken]);
        } else {
            await pool.query(userQueries.devices.deleteByToken, [dto.pushToken]);
        }
    }

    if (dto.refreshToken) {
        await pool.query(authQueries.session.deleteByToken, [dto.refreshToken]);
    }

    return true;
};

/**
 * Generates a 6-digit OTP code for password reset and sends it via email.
 */
export const sendResetEmail = async (dto: SendResetEmailDto): Promise<boolean> => {
    const result = await pool.query<Pick<IUser, "id">>(authQueries.user.findIdByEmail, [dto.email]);
    const user = result.rows[0];

    if (!user) {
        throw new ApiError("ACCOUNT_NOT_FOUND", 404);
    }

    // Generate 6-digit numeric OTP code (cryptographically secure)
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(authQueries.token.setByEmail, [otpCode, otpExpires, dto.email]);

    await sendPasswordResetEmail(dto.email, otpCode);

    return true;
};

/**
 * Verifies OTP code and provides a single-use secure reset ticket for password modification.
 */
export const verifyCode = async (dto: VerifyCodeDto): Promise<VerifyCodeResponse> => {
    const result = await pool.query<Pick<IUser, "id">>(authQueries.token.verify, [dto.email, dto.code]);
    const user = result.rows[0];

    if (!user) {
        throw new ApiError("INVALID_VERIFICATION_CODE", 401);
    }

    // Generate secure random ticket for resetting password
    const ticket = crypto.randomBytes(32).toString("hex");
    const ticketExpires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(authQueries.token.setById, [ticket, ticketExpires, user.id]);

    return { ticket };
};

/**
 * Resets user password using valid ticket and revokes all active sessions for security.
 */
export const updatePassword = async (dto: UpdatePasswordDto): Promise<boolean> => {
    const result = await pool.query<Pick<IUser, "id">>(authQueries.user.findByTicket, [dto.ticket]);
    const user = result.rows[0];

    if (!user) {
        throw new ApiError("INVALID_SESSION", 401);
    }

    const hashedNewPassword = await hashPassword(dto.newPassword);

    // Update password & invalidate reset token
    await pool.query(authQueries.user.updatePassword, [hashedNewPassword, user.id]);

    await pool.query(authQueries.token.setNullById, [user.id]);

    // Revoke all active sessions for safety after password change
    await pool.query(authQueries.session.deleteByUserId, [user.id]);

    return true;
};

/**
 * Reactivates a soft-deleted user account and logs them in
 */
export const reactivateUser = async (dto: LoginUserDto): Promise<LoginUserResponse> => {
    // 1. Fetch user by email
    const result = await pool.query<IUser & { password: string }>(authQueries.user.findByEmail, [dto.email]);
    const dbUser = result.rows[0];
    if (!dbUser) {
        throw new ApiError("INVALID_CREDENTIALS", 401);
    }

    // 2. Verify password
    if (!dbUser.password) {
        const oauthResult = await pool.query<{ provider: string }>(authQueries.oauth.findProvidersByUserId, [
            dbUser.id,
        ]);
        const provider = oauthResult.rows[0]?.provider || "google";
        const formattedProvider = provider.charAt(0).toUpperCase() + provider.slice(1);

        throw new ApiError(
            "OAUTH_ACCOUNT_NO_PASSWORD",
            400,
            MESSAGES.ERRORS.OAUTH_ACCOUNT_NO_PASSWORD(formattedProvider),
        );
    }

    const isValid = await comparePassword(dto.password, dbUser.password);
    if (!isValid) {
        throw new ApiError("INVALID_CREDENTIALS", 401);
    }

    // 3. Reactivate if soft-deleted
    if (dbUser.deletedAt) {
        await pool.query(authQueries.user.reactivate, [dbUser.id]);
        dbUser.deletedAt = null;
    }

    // 4. Generate tokens
    const { password, ...user } = dbUser;
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // 5. Create new session
    await pool.query(authQueries.session.create, [user.id, refreshToken]);

    return { user, accessToken, refreshToken };
};

/**
 * Authenticates or registers a user via Google OAuth.
 *
 * Flow:
 * 1. Verify the Google ID token
 * 2. Look up OAuthAccount by provider + providerAccountId
 * 3. If found → fetch user
 * 4. If not found → check if email exists in User table
 *    a. Email exists → link OAuthAccount to existing user
 *    b. Email doesn't exist → create new User + OAuthAccount (within a transaction)
 * 5. Generate JWT tokens and create session
 */
export const googleAuth = async (dto: GoogleAuthDto): Promise<GoogleAuthResponse> => {
    // 1. Verify Google ID token
    const payload = await verifyGoogleToken(dto.idToken);
    if (!payload) {
        throw new ApiError("INVALID_GOOGLE_TOKEN", 401);
    }

    const { sub, email, name, picture } = payload;

    let userId: string;

    // 2. Check if OAuthAccount already exists for this Google account
    const oauthResult = await pool.query<{ userId: string }>(authQueries.oauth.findByProvider, ["google", sub]);
    const existingOAuth = oauthResult.rows[0];

    if (existingOAuth) {
        // 3. OAuth account found — use the linked userId
        userId = existingOAuth.userId;
    } else {
        // 4. OAuth account not found — check if email is already registered
        const emailResult = await pool.query<Pick<IUser, "id">>(authQueries.oauth.findUserByEmail, [email]);
        const existingUser = emailResult.rows[0];

        if (existingUser) {
            // 4a. Email exists — link OAuthAccount to existing user
            userId = existingUser.id;
            await pool.query(authQueries.oauth.createAccount, [userId, "google", sub]);
        } else {
            // 4b. Email doesn't exist — create new User + OAuthAccount in a transaction
            const client = await pool.connect();
            try {
                await client.query("BEGIN");

                // Generate a unique username from email prefix
                const rawUsername = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
                let username = rawUsername;

                const usernameCheck = await client.query(authQueries.oauth.isUsernameTaken, [username]);
                if (usernameCheck.rows.length > 0) {
                    const suffix = crypto.randomInt(1000, 10000).toString();
                    username = `${rawUsername}${suffix}`;
                }

                // Create user (password is NULL for OAuth-only accounts)
                const newUserResult = await client.query<IUser>(authQueries.oauth.createUserWithOAuth, [
                    email,
                    username,
                    name || null,
                    picture || null,
                ]);
                userId = newUserResult.rows[0].id;

                // Create OAuthAccount linked to the new user
                await client.query(authQueries.oauth.createAccount, [userId, "google", sub]);

                await client.query("COMMIT");
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            } finally {
                client.release();
            }
        }
    }

    // 5. Fetch full user profile for the response
    const userResult = await pool.query<IUser>(authQueries.oauth.findUserById, [userId]);
    const user = userResult.rows[0];

    // 6. Generate JWT tokens and create session
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    await pool.query(authQueries.session.create, [user.id, refreshToken]);

    return { user, accessToken, refreshToken };
};
