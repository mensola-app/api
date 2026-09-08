import { Router } from "express";

// Controllers
import {
    register,
    login,
    refresh,
    logout,
    forgotPassword,
    verifyResetCode,
    resetPassword,
    reactivate,
    googleLogin,
} from "@/controllers/v1/auth.controller";

// Middlewares & Validations
import { validate } from "@/middlewares/validate.middleware";
import {
    registerSchema,
    loginSchema,
    refreshTokenSchema,
    forgotPasswordSchema,
    verifyResetCodeSchema,
    resetPasswordSchema,
    googleAuthSchema,
} from "@/validations/auth.validation";
import { authLimiter, forgotPasswordLimiter } from "@/middlewares/rateLimit.middleware";

const router = Router();

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user account
 * @access  Public
 */
router.post("/register", validate(registerSchema), register);

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user & return access/refresh tokens
 * @access  Public
 */
router.post("/login", authLimiter, validate(loginSchema), login);

/**
 * @route   POST /api/auth/reactivate
 * @desc    Reactivate a soft-deleted user account and log in
 * @access  Public
 */
router.post("/reactivate", authLimiter, validate(loginSchema), reactivate);

/**
 * @route   POST /api/auth/refresh
 * @desc    Generate a new access token using a valid refresh token
 * @access  Public
 */
router.post("/refresh", validate(refreshTokenSchema), refresh);

/**
 * @route   POST /api/auth/logout
 * @desc    Log out the user and invalidate active session
 * @access  Public / Authenticated
 */
router.post("/logout", logout);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Initiate password reset process & send verification code
 * @access  Public
 */
router.post("/forgot-password", forgotPasswordLimiter, validate(forgotPasswordSchema), forgotPassword);

/**
 * @route   POST /api/auth/verify-reset-code
 * @desc    Verify password reset verification code
 * @access  Public
 */
router.post("/verify-reset-code", authLimiter, validate(verifyResetCodeSchema), verifyResetCode);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password using a verified code
 * @access  Public
 */
router.post("/reset-password", validate(resetPasswordSchema), resetPassword);

/**
 * @route   POST /api/auth/google
 * @desc    Authenticate or register user via Google OAuth
 * @access  Public
 */
router.post("/google", authLimiter, validate(googleAuthSchema), googleLogin);

export default router;
