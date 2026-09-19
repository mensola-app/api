import pool from "@/config/db";
import { shortLinkQueries } from "@/queries/shortLink.queries";
import { CreateShortLinkDto, ShortLink, ShortLinkResponse } from "@/types/shortLink.types";
import { ApiError } from "@/utils/error";
import { customAlphabet } from "nanoid";
import { getOrSetCache, setCache } from "@/utils/cache";

// 58-character unambiguous alphabet (excluding 0, O, I, l)
const UNAMBIGUOUS_ALPHABET = "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const generateCode = customAlphabet(UNAMBIGUOUS_ALPHABET, 5);

const SHORT_LINK_CACHE_PREFIX = "shortlink:";
const SHORT_LINK_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days (links are immutable once created)

export const shortLinkService = {
    /**
     * Finds existing short link or creates a new 5-character unique code with collision retry.
     * Pre-warms the cache on creation or retrieval.
     */
    async createOrGetShortLink(dto: CreateShortLinkDto): Promise<{ code: string }> {
        const { targetType, targetId } = dto;

        // 1. Check if matching target already has a short code
        const existingResult = await pool.query<ShortLink>(shortLinkQueries.findByTarget, [targetType, targetId]);
        if (existingResult.rows.length > 0) {
            const shortLink = existingResult.rows[0];
            await setCache(
                `${SHORT_LINK_CACHE_PREFIX}${shortLink.code}`,
                { targetType: shortLink.targetType, targetId: shortLink.targetId },
                SHORT_LINK_CACHE_TTL_SECONDS,
            );
            return { code: shortLink.code };
        }

        // 2. Generate unique 5-char code and insert with collision retry
        const MAX_RETRIES = 5;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const code = generateCode();
            try {
                const insertResult = await pool.query<ShortLink>(shortLinkQueries.create, [code, targetType, targetId]);
                const created = insertResult.rows[0];
                await setCache(
                    `${SHORT_LINK_CACHE_PREFIX}${created.code}`,
                    { targetType: created.targetType, targetId: created.targetId },
                    SHORT_LINK_CACHE_TTL_SECONDS,
                );
                return { code: created.code };
            } catch (err: any) {
                // Check if error is unique violation (PostgreSQL error code 23505)
                if (err.code === "23505") {
                    // Check if another concurrent process just inserted the same target
                    const concurrentCheck = await pool.query<ShortLink>(shortLinkQueries.findByTarget, [targetType, targetId]);
                    if (concurrentCheck.rows.length > 0) {
                        const existing = concurrentCheck.rows[0];
                        await setCache(
                            `${SHORT_LINK_CACHE_PREFIX}${existing.code}`,
                            { targetType: existing.targetType, targetId: existing.targetId },
                            SHORT_LINK_CACHE_TTL_SECONDS,
                        );
                        return { code: existing.code };
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
     * Uses Redis cache to resolve links in <1ms without hitting PostgreSQL.
     */
    async getShortLinkByCode(code: string): Promise<ShortLinkResponse> {
        return getOrSetCache<ShortLinkResponse>(
            `${SHORT_LINK_CACHE_PREFIX}${code}`,
            SHORT_LINK_CACHE_TTL_SECONDS,
            async () => {
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
        );
    },
};

