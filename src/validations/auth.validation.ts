import { z } from "zod";
import { MESSAGES } from "../constants/messages/tr";
import { emailRule, passwordRule, usernameRule, userIdRule } from "./common.validation";

/**
 * Authentication Request Validation Schemas
 *
 * Defines Zod validation rules for incoming HTTP request parts (body, params, query).
 * Used alongside the validation middleware to sanitize and enforce schema contracts.
 */

/** Schema for validating user registration payloads. */
const registerSchema = z.object({
    body: z.object({ email: emailRule, username: usernameRule, password: passwordRule }),
});

/** Schema for validating user login payloads. */
const loginSchema = z.object({
    body: z.object({ email: emailRule, password: passwordRule }),
});

/** Schema for validating token refresh requests. */
const refreshTokenSchema = z.object({
    body: z.object({
        refreshToken: z.string({ message: MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.REFRESH_TOKEN) }),
    }),
});

/** Schema for validating password reset email requests. */
const forgotPasswordSchema = z.object({
    body: z.object({ email: emailRule }),
});

/** Schema for validating password reset OTP verification requests. */
const verifyResetCodeSchema = z.object({
    body: z.object({
        email: emailRule,
        code: z
            .string({ message: MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.VERIFICATION_CODE) })
            .length(6, "Doğrulama kodu 6 haneli olmalıdır."),
    }),
});

/** Schema for validating final password updates using a reset ticket. */
const resetPasswordSchema = z.object({
    body: z.object({
        ticket: z.string({ message: MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.TICKET) }),
        newPassword: passwordRule,
    }),
});

/** Schema for validating Google OAuth login payloads. */
const googleAuthSchema = z.object({
    body: z.object({
        idToken: z.string({ message: MESSAGES.ERRORS.FIELD_REQUIRED("ID Token") }),
    }),
});

/** Schema for validating logout payloads. */
const logoutSchema = z.object({
    body: z.object({
        refreshToken: z.string().optional(),
        pushToken: z.string().optional(),
    }).passthrough(),
});

export {
    registerSchema,
    loginSchema,
    refreshTokenSchema,
    forgotPasswordSchema,
    verifyResetCodeSchema,
    resetPasswordSchema,
    googleAuthSchema,
    logoutSchema,
};

