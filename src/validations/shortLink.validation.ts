import { z } from "zod";

export const createShortLinkSchema = z.object({
    body: z.object({
        targetType: z.enum(["movie_list", "playlist", "user"]),
        targetId: z.string().uuid(),
    }),
});

export const getShortLinkSchema = z.object({
    params: z.object({
        code: z.string().min(1).max(8),
    }),
});
