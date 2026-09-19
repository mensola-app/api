import { z } from "zod";

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
