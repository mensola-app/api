import { z } from "zod";

export const importSpotifySchema = z.object({
    body: z.object({
        urls: z
            .union([
                z.array(z.string().min(1, "URL cannot be empty")),
                z.string().min(1, "URL cannot be empty").transform((val) => [val]),
            ])
            .refine((arr) => arr.length >= 1, {
                message: "At least one Spotify playlist URL or ID is required.",
            })
            .refine((arr) => arr.length <= 10, {
                message: "Maximum 10 playlists can be imported at once.",
            }),
    }),
});

export type ImportSpotifyBody = z.infer<typeof importSpotifySchema>["body"];
