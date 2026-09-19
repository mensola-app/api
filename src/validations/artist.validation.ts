import { z } from "zod";
import { pageQueryRule, limitQueryRule } from "./common.validation";

export const artistFollowParamSchema = z.object({
    params: z.object({
        id: z.string().min(1).max(255),
    }),
});

// Same shape, kept as a separate export for clarity in route registration
export const artistIdParamSchema = z.object({
    params: z.object({
        id: z.string().min(1).max(255),
    }),
});

export const artistDiscographyQuerySchema = z.object({
    params: z.object({
        id: z.string().min(1).max(255),
    }),
    query: z.object({
        page: pageQueryRule,
        limit: limitQueryRule,
    }),
});

