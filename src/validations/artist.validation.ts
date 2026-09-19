import { z } from "zod";

export const artistFollowParamSchema = z.object({
    params: z.object({
        id: z.string().min(1).max(255),
    }),
});
