import { z } from "zod";
import { limitQueryRule, pageQueryRule, userIdRule, usernameRule, emailRule, passwordRule } from "./common.validation";
import { MESSAGES } from "../constants/messages/tr";

/**
 * User Followers & Following Query Schema
 */
export const userListQuerySchema = z.object({
    query: z.object({ page: pageQueryRule, limit: limitQueryRule, userId: userIdRule }).passthrough(),
});

/**
 * User ID Params Schema
 */
export const userIdParamSchema = z.object({
    params: z
        .object({ userId: z.string({ message: MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.USER_ID) }) })
        .passthrough(),
});

/**
 * Update Profile Body Schema
 */
export const updateProfileSchema = z.object({
    body: z
        .object({
            fullname: z
                .string()
                .min(2, MESSAGES.ERRORS.MIN_LENGTH(MESSAGES.FIELDS.FULL_NAME, 2))
                .max(50, MESSAGES.ERRORS.MAX_LENGTH(MESSAGES.FIELDS.FULL_NAME, 50))
                .optional(),
            bio: z.string().max(160, MESSAGES.ERRORS.MAX_LENGTH(MESSAGES.FIELDS.BIO, 160)).optional(),
            avatar: z.string().nullable().optional(),
        })
        .refine((data) => Object.keys(data).length > 0, {
            message: MESSAGES.ERRORS.AT_LEAST_ONE_FIELD_REQUIRED,
        }),
});

/**
 * Update Username Body Schema
 */
export const updateUsernameSchema = z.object({
    body: z.object({
        username: usernameRule,
    }),
});

/**
 * Check Username Query Schema
 */
export const checkUsernameQuerySchema = z.object({
    query: z.object({
        username: usernameRule,
    }),
});

/**
 * Request Email Change Body Schema
 */
export const requestEmailChangeSchema = z.object({
    body: z.object({
        email: emailRule,
        password: passwordRule,
    }),
});

/**
 * Verify Email Change Body Schema
 */
export const verifyEmailChangeSchema = z.object({
    body: z.object({
        email: emailRule,
        code: z
            .string({ message: MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.VERIFICATION_CODE) })
            .length(6, MESSAGES.ERRORS.MIN_LENGTH(MESSAGES.FIELDS.VERIFICATION_CODE, 6)),
    }),
});

/**
 * Change Password Body Schema
 */
export const changePasswordSchema = z.object({
    body: z.object({
        currentPassword: passwordRule,
        newPassword: passwordRule,
    }),
});

/**
 * Update Profile Privacy Body Schema
 */
export const updatePrivacySchema = z.object({
    body: z.object({
        isPrivate: z.boolean({
            message: "isPrivate değeri boolean olmalıdır.",
        }),
    }),
});

/**
 * Search Users Query Schema
 */
export const searchUserQuerySchema = z.object({
    query: z
        .object({
            q: z.string().min(1, MESSAGES.ERRORS.FIELD_REQUIRED("Arama sorgusu")),
            page: pageQueryRule,
            limit: limitQueryRule,
        })
        .passthrough(),
});
