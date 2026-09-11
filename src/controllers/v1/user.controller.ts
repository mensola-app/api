import { Response, NextFunction, Request } from "express";

import { getUserProfile, profileUpdate, getFollowers, getFollowing, follow, unfollow, updateUsername, checkUsernameAvailability, requestEmailChange, verifyEmailChange, changePassword, updateProfilePrivacy, softDeleteAccount, searchUsers } from "@/services/user.service";

import { sendResponse } from "@/utils/response";

import { TypedRequest, TypedRequestBody, TypedRequestQuery } from "@/types/express.types";
import { ProfileUpdateDto } from "@/types/user.types";
import { UserId } from "@/types/common.types";
import { MESSAGES } from "@/constants/messages";

/**
 * Query parameters contract for paginated list requests
 */
type PaginationQuery = {
    page?: string;
    limit?: string;
    userId?: UserId;
};

/**
 * Fetches the authenticated user's own profile.
 */
const getMe = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user!.id;
        const profile = await getUserProfile({ targetUserId: userId, viewerId: userId });

        return sendResponse(res, 200, { profile });
    } catch (error) {
        next(error);
    }
};

/**
 * Fetches a target user's profile by URL parameter ID.
 */
const getUserById = async (req: TypedRequest<{ userId: UserId }>, res: Response, next: NextFunction) => {
    try {
        const targetUserId = req.params.userId;
        const viewerId = req.user?.id;

        const profile = await getUserProfile({ targetUserId, viewerId });

        return sendResponse(res, 200, { profile });
    } catch (error) {
        next(error);
    }
};

/**
 * Updates profile fields for the authenticated user.
 */
const updateProfile = async (
    req: TypedRequestBody<ProfileUpdateDto["updateData"]>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const updatedFields = await profileUpdate({
            userId,
            updateData: req.body,
        });

        return sendResponse(res, 200, { user: updatedFields }, MESSAGES.SUCCESS.PROFILE_UPDATED);
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves a paginated list of followers for a user.
 */
const getUserFollowers = async (req: TypedRequestQuery<PaginationQuery>, res: Response, next: NextFunction) => {
    try {
        const targetUserId: UserId = (req.query.userId || req.user?.id) as UserId;

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const viewerId = req.user?.id;

        const followers = await getFollowers({
            page,
            limit,
            targetUserId,
            viewerId,
        });

        return sendResponse(res, 200, {
            items: followers,
            page,
            limit,
            hasMore: followers.length === limit,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves a paginated list of users that a target user is following.
 */
const getUserFollowing = async (req: TypedRequestQuery<PaginationQuery>, res: Response, next: NextFunction) => {
    try {
        const targetUserId = (req.query.userId || req.user?.id) as UserId;

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const viewerId = req.user?.id;

        const following = await getFollowing({
            page,
            limit,
            targetUserId,
            viewerId,
        });

        return sendResponse(res, 200, {
            items: following,
            page,
            limit,
            hasMore: following.length === limit,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Creates a follow relationship with the target user.
 */
const followUser = async (req: TypedRequest<{ userId: UserId }>, res: Response, next: NextFunction) => {
    try {
        const targetUserId = req.params.userId;
        const currentUserId = req.user!.id;

        const result = await follow({ followerId: currentUserId, followingId: targetUserId });

        const message =
            result.status === "pending"
                ? MESSAGES.SUCCESS.FOLLOW_REQUEST_SENT
                : MESSAGES.SUCCESS.USER_FOLLOWED;

        return sendResponse(res, 201, result, message);
    } catch (error) {
        next(error);
    }
};

/**
 * Removes a follow relationship with the target user.
 */
const unfollowUser = async (req: TypedRequest<{ userId: UserId }>, res: Response, next: NextFunction) => {
    try {
        const targetUserId = req.params.userId;
        const currentUserId = req.user!.id;

        await unfollow({ followerId: currentUserId, followingId: targetUserId });

        return sendResponse(res, 200, null, MESSAGES.SUCCESS.USER_UNFOLLOWED);
    } catch (error) {
        next(error);
    }
};

/**
 * Updates the username for the authenticated user.
 */
const changeUsername = async (
    req: TypedRequestBody<{ username: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const { username } = req.body;
        const updatedFields = await updateUsername({
            userId,
            username,
        });

        return sendResponse(res, 200, { user: updatedFields }, MESSAGES.SUCCESS.USERNAME_UPDATED);
    } catch (error) {
        next(error);
    }
};

/**
 * Checks if a username is available in the database.
 */
const verifyUsername = async (
    req: TypedRequestQuery<{ username: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const { username } = req.query;
        const availability = await checkUsernameAvailability(username);
        return sendResponse(res, 200, availability, MESSAGES.SUCCESS.RETRIEVED_SUCCESSFULLY);
    } catch (error) {
        next(error);
    }
};

/**
 * Request verification code to change email.
 */
const requestEmailChangeController = async (
    req: TypedRequestBody<{ email: string; password?: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const { email, password } = req.body;

        await requestEmailChange({
            userId,
            email,
            password,
        });

        return sendResponse(res, 200, null, MESSAGES.SUCCESS.EMAIL_CHANGE_CODE_SENT);
    } catch (error) {
        next(error);
    }
};

/**
 * Verifies code and completes email update.
 */
const verifyEmailChangeController = async (
    req: TypedRequestBody<{ email: string; code: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const { email, code } = req.body;

        const updatedFields = await verifyEmailChange({
            userId,
            email,
            code,
        });

        return sendResponse(res, 200, { user: updatedFields }, MESSAGES.SUCCESS.EMAIL_UPDATED);
    } catch (error) {
        next(error);
    }
};

/**
 * Changes authenticated user's password, invalidates other sessions, and returns new tokens.
 */
const changePasswordController = async (
    req: TypedRequestBody<{ currentPassword?: string; newPassword?: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const { currentPassword, newPassword } = req.body;

        const tokens = await changePassword({
            userId,
            currentPassword,
            newPassword,
        });

        return sendResponse(res, 200, tokens, MESSAGES.SUCCESS.PASSWORD_CHANGED);
    } catch (error) {
        next(error);
    }
};

/**
 * Updates profile privacy settings for authenticated user.
 */
const updatePrivacyController = async (
    req: TypedRequestBody<{ isPrivate: boolean }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;
        const { isPrivate } = req.body;

        const updatedFields = await updateProfilePrivacy(userId, isPrivate);

        return sendResponse(res, 200, { user: updatedFields }, MESSAGES.SUCCESS.PRIVACY_UPDATED);
    } catch (error) {
        next(error);
    }
};

/**
 * Soft deletes the authenticated user's account and revokes all active sessions.
 */
const deleteMeController = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.user!.id;

        await softDeleteAccount(userId);

        return sendResponse(res, 200, null, MESSAGES.SUCCESS.ACCOUNT_DELETED);
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves a paginated list of users matching the search query.
 */
const searchUsersController = async (
    req: TypedRequestQuery<{ q: string; page?: string; limit?: string }>,
    res: Response,
    next: NextFunction,
) => {
    try {
        const query = req.query.q as string;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const viewerId = req.user?.id;

        const users = await searchUsers({
            query,
            page,
            limit,
            viewerId,
        });

        return sendResponse(res, 200, {
            items: users,
            page,
            limit,
            hasMore: users.length === limit,
        });
    } catch (error) {
        next(error);
    }
};

export { getMe, getUserById, updateProfile, getUserFollowers, getUserFollowing, followUser, unfollowUser, changeUsername, verifyUsername, requestEmailChangeController, verifyEmailChangeController, changePasswordController, updatePrivacyController, deleteMeController, searchUsersController };
