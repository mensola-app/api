import { Router } from "express";

// Controllers
import {
    getMe,
    getUserById,
    updateProfile,
    getUserFollowers,
    getUserFollowing,
    followUser,
    unfollowUser,
    changeUsername,
    verifyUsername,
    requestEmailChangeController,
    verifyEmailChangeController,
    changePasswordController,
    updatePrivacyController,
    deleteMeController,
    searchUsersController,
} from "@/controllers/v1/user.controller";
import {
    handleAcceptFollowRequest,
    handleDeclineFollowRequest,
} from "@/controllers/v1/notification.controller";

// Middlewares
import { verifyToken, extractUser } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";

// Validations
import { userListQuerySchema, userIdParamSchema, updateProfileSchema, updateUsernameSchema, checkUsernameQuerySchema, requestEmailChangeSchema, verifyEmailChangeSchema, changePasswordSchema, updatePrivacySchema, searchUserQuerySchema } from "@/validations/user.validation";
import { requiredUserId } from "@/middlewares/requiredId.middleware";

const router = Router();

/* ==========================================================================
   Public General User Routes
   ========================================================================== */

/**
 * @route   GET /api/users/check-username
 * @desc    Check if a username is available (unauthenticated)
 * @access  Public
 */
router.get("/check-username", validate(checkUsernameQuerySchema), verifyUsername);

/* ==========================================================================
   Current User Profile Routes (/me)
   ========================================================================== */

/**
 * @route   GET /api/users/me
 * @desc    Fetch the authenticated user's own profile details
 * @access  Private (Requires valid Access Token)
 */
router.get("/me", verifyToken, getMe);

/**
 * @route   PATCH /api/users/me
 * @desc    Update authenticated user's profile fields (fullname, bio, avatar)
 * @access  Private (Requires valid Access Token)
 */
router.patch("/me", verifyToken, validate(updateProfileSchema), updateProfile);

/**
 * @route   DELETE /api/users/me
 * @desc    Soft delete the authenticated user's account
 * @access  Private (Requires valid Access Token)
 */
router.delete("/me", verifyToken, deleteMeController);

/**
 * @route   PATCH /api/users/username
 * @desc    Update authenticated user's username (with 30-day rate limit)
 * @access  Private (Requires valid Access Token)
 */
router.patch("/username", verifyToken, validate(updateUsernameSchema), changeUsername);

/**
 * @route   POST /api/users/email/request
 * @desc    Request verification code to change email
 * @access  Private (Requires valid Access Token)
 */
router.post("/email/request", verifyToken, validate(requestEmailChangeSchema), requestEmailChangeController);

/**
 * @route   POST /api/users/email/verify
 * @desc    Verify verification code and complete email change
 * @access  Private (Requires valid Access Token)
 */
router.post("/email/verify", verifyToken, validate(verifyEmailChangeSchema), verifyEmailChangeController);

/**
 * @route   PATCH /api/users/password
 * @desc    Change authenticated user's password and refresh sessions
 * @access  Private (Requires valid Access Token)
 */
router.patch("/password", verifyToken, validate(changePasswordSchema), changePasswordController);

/**
 * @route   PATCH /api/users/privacy
 * @desc    Update profile privacy status for authenticated user
 * @access  Private (Requires valid Access Token)
 */
router.patch("/privacy", verifyToken, validate(updatePrivacySchema), updatePrivacyController);

/* ==========================================================================
   Social Connections & Graph Routes (Followers / Following)
   ========================================================================== */

/**
 * @route   GET /api/users/followers
 * @desc    Get paginated followers list for a target user (or current user)
 * @access  Public / Optional Auth (Attaches viewer context if authenticated)
 */
router.get("/followers", extractUser, validate(userListQuerySchema), requiredUserId, getUserFollowers);

/**
 * @route   GET /api/users/following
 * @desc    Get paginated following list for a target user (or current user)
 * @access  Public / Optional Auth (Attaches viewer context if authenticated)
 */
router.get("/following", extractUser, validate(userListQuerySchema), requiredUserId, getUserFollowing);

/* ==========================================================================
   Follow & Unfollow Actions
   ========================================================================== */

/**
 * @route   POST /api/users/:userId/follow
 * @desc    Follow a target user by ID
 * @access  Private (Requires valid Access Token)
 */
router.post("/:userId/follow", verifyToken, validate(userIdParamSchema), followUser);

/**
 * @route   DELETE /api/users/:userId/follow
 * @desc    Unfollow a target user by ID
 * @access  Private (Requires valid Access Token)
 */
router.delete("/:userId/follow", verifyToken, validate(userIdParamSchema), unfollowUser);

/**
 * @route   POST /api/users/follow-requests/:userId/accept
 * @desc    Accept a pending follow request
 * @access  Private (Requires valid Access Token)
 */
router.post(
    "/follow-requests/:userId/accept",
    verifyToken,
    validate(userIdParamSchema),
    handleAcceptFollowRequest
);

/**
 * @route   POST /api/users/follow-requests/:userId/decline
 * @desc    Decline a pending follow request
 * @access  Private (Requires valid Access Token)
 */
router.post(
    "/follow-requests/:userId/decline",
    verifyToken,
    validate(userIdParamSchema),
    handleDeclineFollowRequest
);

/* ==========================================================================
   Public Profile Routes
   ========================================================================== */

/**
 * @route   GET /api/users/search
 * @desc    Search users by username or fullname
 * @access  Public / Optional Auth (Attaches viewer context if authenticated)
 */
router.get("/search", extractUser, validate(searchUserQuerySchema), searchUsersController);

/**
 * @route   GET /api/users/:userId
 * @desc    Get public profile details by user ID
 * @access  Public / Optional Auth (Includes contextual fields like isFollowingByMe if token provided)
 * @note    Must be placed at the bottom to prevent route matching collisions with static endpoints
 */
router.get("/:userId", extractUser, validate(userIdParamSchema), getUserById);

export default router;
