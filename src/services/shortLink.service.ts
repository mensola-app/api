import pool from "@/config/db";
import { shortLinkQueries } from "@/queries/shortLink.queries";
import { CreateShortLinkDto, ShortLink, ShortLinkResponse } from "@/types/shortLink.types";
import { ApiError } from "@/utils/error";
import { customAlphabet } from "nanoid";

// 58-character unambiguous alphabet (excluding 0, O, I, l)
const UNAMBIGUOUS_ALPHABET = "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const generateCode = customAlphabet(UNAMBIGUOUS_ALPHABET, 5);

export const shortLinkService = {
    /**
     * Finds existing short link or creates a new 5-character unique code with collision retry.
     */
    async createOrGetShortLink(dto: CreateShortLinkDto): Promise<{ code: string }> {
        const { targetType, targetId } = dto;

        // 1. Check if matching target already has a short code
        const existingResult = await pool.query<ShortLink>(shortLinkQueries.findByTarget, [targetType, targetId]);
        if (existingResult.rows.length > 0) {
            return { code: existingResult.rows[0].code };
        }

        // 2. Generate unique 5-char code and insert with collision retry
        const MAX_RETRIES = 5;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const code = generateCode();
            try {
                const insertResult = await pool.query<ShortLink>(shortLinkQueries.create, [code, targetType, targetId]);
                return { code: insertResult.rows[0].code };
            } catch (err: any) {
                // Check if error is unique violation (PostgreSQL error code 23505)
                if (err.code === "23505") {
                    // Check if another concurrent process just inserted the same target
                    const concurrentCheck = await pool.query<ShortLink>(shortLinkQueries.findByTarget, [targetType, targetId]);
                    if (concurrentCheck.rows.length > 0) {
                        return { code: concurrentCheck.rows[0].code };
                    }
                    // Collision on random code, retry loop
                    continue;
                }
                throw err;
            }
        }

        throw new ApiError("INTERNAL_SERVER_ERROR", 500, "Failed to generate unique short link code");
    },

    /**
     * Resolves short link by code or throws 404.
     */
    async getShortLinkByCode(code: string): Promise<ShortLinkResponse> {
        const result = await pool.query<ShortLink>(shortLinkQueries.findByCode, [code]);
        const shortLink = result.rows[0];

        if (!shortLink) {
            throw new ApiError("NOT_FOUND", 404);
        }

        return {
            targetType: shortLink.targetType,
            targetId: shortLink.targetId,
        };
    },
};
