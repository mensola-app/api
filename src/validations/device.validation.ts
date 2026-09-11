import { z } from "zod";

export const registerDeviceSchema = z.object({
    body: z.object({
        pushToken: z.string().min(1, "pushToken is required"),
        locale: z.string().min(2, "locale must be at least 2 characters").max(10, "locale cannot exceed 10 characters"),
        platform: z.string().optional(),
    }),
});

export const updateDeviceLocaleSchema = z.object({
    params: z.object({
        id: z.string().uuid("Invalid device ID format"),
    }),
    body: z.object({
        locale: z.string().min(2, "locale must be at least 2 characters").max(10, "locale cannot exceed 10 characters"),
    }),
});

export const deviceIdParamSchema = z.object({
    params: z.object({
        id: z.string().uuid("Invalid device ID format"),
    }),
});
