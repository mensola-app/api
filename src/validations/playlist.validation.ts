import { z } from "zod";
import {
    createOrUpdateInteractionBody,
    limitQueryRule,
    pageQueryRule,
    trackIdRule,
    userIdRule,
} from "./common.validation";
import { MESSAGES } from "../constants/messages/tr";

export const playlistIdRule = z
    .string({ message: MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.PLAYLIST_ID) })
    .uuid(MESSAGES.ERRORS.INVALID_UUID(MESSAGES.FIELDS.PLAYLIST_ID))
    .trim();

export const listTitleRule = z
    .string({ message: MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.TITLE) })
    .trim()
    .min(1, MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.TITLE))
    .max(100, MESSAGES.ERRORS.MAX_LENGTH(MESSAGES.FIELDS.TITLE, 100));

export const listDescRule = z
    .string()
    .trim()
    .max(500, MESSAGES.ERRORS.MAX_LENGTH(MESSAGES.FIELDS.DESCRIPTION, 500))
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

export const listImageRule = z
    .union([
        z.string().url(MESSAGES.ERRORS.INVALID_URL),
        z.literal(""),
    ])
    .nullable()
    .optional()
    .transform((val) => (val === "" ? null : val));

export const listIsPrivateRule = z
    .boolean({ message: MESSAGES.ERRORS.FIELD_REQUIRED(MESSAGES.FIELDS.IS_PRIVATE) })
    .optional();

export const playlistPaginationQuerySchema = z.object({
    query: z.object({
        userId: userIdRule,
        trackId: trackIdRule.optional(),
        page: pageQueryRule,
        limit: limitQueryRule,
    }),
});

export const playlistIdParamSchema = z.object({
    params: z.object({ playlistId: playlistIdRule }),
    query: z.object({ page: pageQueryRule, limit: limitQueryRule }),
});

export const createPlaylistInteractionSchema = z.object({
    params: z.object({ playlistId: playlistIdRule }),
    body: createOrUpdateInteractionBody,
});

export const addTrackToPlaylistSchema = z.object({
    params: z.object({ playlistId: playlistIdRule, trackId: trackIdRule }),
});

export const createPlaylistSchema = z.object({
    body: z.object(
        {
            title: listTitleRule,
            description: listDescRule,
            image: listImageRule,
            isPrivate: listIsPrivateRule,
        },
        { message: MESSAGES.ERRORS.MISSING_REQUIRED_FIELDS },
    ),
});

export const updatePlaylistSchema = z.object({
    params: playlistIdParamSchema.shape.params,
    body: z
        .object(
            {
                title: listTitleRule.optional(),
                description: listDescRule,
                image: listImageRule,
                isPrivate: listIsPrivateRule,
            },
            { message: MESSAGES.ERRORS.MISSING_REQUIRED_FIELDS },
        )
        .refine((data) => Object.keys(data).length > 0, MESSAGES.ERRORS.AT_LEAST_ONE_FIELD_REQUIRED),
});

