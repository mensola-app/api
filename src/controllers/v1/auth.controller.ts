import { Response, NextFunction } from "express";
import { sendResponse } from "@/utils/response";

import {
    createUser,
    loginUser,
    tokenRefresh,
    userLogout,
    sendResetEmail,
    verifyCode,
    updatePassword,
    reactivateUser,
    googleAuth,
} from "@/services/auth.service";

import {
    CreateUserDto,
    LoginUserDto,
    TokenRefreshDto,
    LogoutDto,
    SendResetEmailDto,
    VerifyCodeDto,
    UpdatePasswordDto,
    GoogleAuthDto,
} from "@/types/auth.types";
import { TypedRequestBody } from "@/types/express.types";
import { MESSAGES } from "@/constants/messages";

/**
 * Handles user registration
 */
const register = async (req: TypedRequestBody<CreateUserDto>, res: Response, next: NextFunction) => {
    try {
        const responseData = await createUser(req.body);
        return sendResponse(res, 201, responseData, MESSAGES.SUCCESS.REGISTER_SUCCESS);
    } catch (error: any) {
        next(error);
    }
};

/**
 * Handles user authentication
 */
const login = async (req: TypedRequestBody<LoginUserDto>, res: Response, next: NextFunction) => {
    try {
        const responseData = await loginUser(req.body);
        return sendResponse(res, 200, responseData, MESSAGES.SUCCESS.LOGIN_SUCCESS);
    } catch (error) {
        next(error);
    }
};

/**
 * Issues a new access token using a valid refresh token
 */
const refresh = async (req: TypedRequestBody<TokenRefreshDto>, res: Response, next: NextFunction) => {
    try {
        const responseData = await tokenRefresh(req.body);
        return sendResponse(res, 200, responseData);
    } catch (error) {
        next(error);
    }
};

/**
 * Revokes user session and logs out
 */
const logout = async (req: TypedRequestBody<LogoutDto>, res: Response, next: NextFunction) => {
    try {
        await userLogout(req.body);
        return sendResponse(res, 200, null, MESSAGES.SUCCESS.LOGOUT_SUCCESS);
    } catch (error) {
        next(error);
    }
};

/**
 * Initiates password reset flow by sending OTP code
 */
const forgotPassword = async (req: TypedRequestBody<SendResetEmailDto>, res: Response, next: NextFunction) => {
    try {
        await sendResetEmail(req.body);
        return sendResponse(res, 200, null, MESSAGES.SUCCESS.RESET_CODE_SENT);
    } catch (error) {
        next(error);
    }
};

/**
 * Verifies OTP code and returns a reset ticket
 */
const verifyResetCode = async (req: TypedRequestBody<VerifyCodeDto>, res: Response, next: NextFunction) => {
    try {
        const responseData = await verifyCode(req.body);
        return sendResponse(res, 200, responseData);
    } catch (error) {
        next(error);
    }
};

/**
 * Updates password using valid verification ticket
 */
const resetPassword = async (req: TypedRequestBody<UpdatePasswordDto>, res: Response, next: NextFunction) => {
    try {
        await updatePassword(req.body);
        return sendResponse(res, 200, null, MESSAGES.SUCCESS.PASSWORD_UPDATED);
    } catch (error) {
        next(error);
    }
};

/**
 * Reactivates a soft-deleted user account and logs them in
 */
const reactivate = async (req: TypedRequestBody<LoginUserDto>, res: Response, next: NextFunction) => {
    try {
        const responseData = await reactivateUser(req.body);
        return sendResponse(res, 200, responseData, MESSAGES.SUCCESS.ACCOUNT_REACTIVATED);
    } catch (error) {
        next(error);
    }
};

/**
 * Handles Google OAuth sign-in
 */
const googleLogin = async (req: TypedRequestBody<GoogleAuthDto>, res: Response, next: NextFunction) => {
    try {
        const responseData = await googleAuth(req.body);
        return sendResponse(res, 200, responseData, MESSAGES.SUCCESS.GOOGLE_LOGIN_SUCCESS);
    } catch (error) {
        next(error);
    }
};

export { register, login, refresh, logout, forgotPassword, verifyResetCode, resetPassword, reactivate, googleLogin };
