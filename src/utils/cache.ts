import { redis } from "@/config/redis";

/**
 * Retrieves data from cache; if cache miss occurs, executes fetchFn, stores result in cache with given TTL, and returns it.
 * Provides fail-safe fallback: if Redis fails or is unavailable, fetchFn executes seamlessly without breaking the request.
 */
export async function getOrSetCache<T>(key: string, ttlSeconds: number, fetchFn: () => Promise<T>): Promise<T> {
    try {
        const cachedData = await redis.get(key);
        if (cachedData !== null) {
            return JSON.parse(cachedData) as T;
        }
    } catch (error) {
        console.error(`[Redis Get Error] key: ${key}`, error);
    }

    const freshData = await fetchFn();

    if (freshData !== null && freshData !== undefined) {
        try {
            await redis.set(key, JSON.stringify(freshData), "EX", ttlSeconds);
        } catch (error) {
            console.error(`[Redis Set Error] key: ${key}`, error);
        }
    }

    return freshData;
}

/**
 * Deletes cached data for the specified key(s).
 */
export async function deleteCache(key: string | string[]): Promise<void> {
    try {
        const keys = Array.isArray(key) ? key : [key];
        if (keys.length > 0) {
            await redis.del(...keys);
        }
    } catch (error) {
        console.error(`[Redis Del Error] keys: ${key}`, error);
    }
}

/**
 * Deletes keys matching a pattern using non-blocking SCAN iteration.
 */
export async function deleteCachePattern(pattern: string): Promise<void> {
    try {
        let cursor = "0";
        do {
            const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
            cursor = nextCursor;
            if (keys.length > 0) {
                await redis.del(...keys);
            }
        } while (cursor !== "0");
    } catch (error) {
        console.error(`[Redis Scan & Del Error] pattern: ${pattern}`, error);
    }
}

