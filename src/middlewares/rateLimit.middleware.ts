import { MESSAGES } from "@/constants/messages";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "@/config/redis";

/**
 * Creates a RedisStore instance for express-rate-limit with a custom key prefix.
 * Falls back to default MemoryStore in test environment to keep unit tests fast and isolated.
 */
const createRedisStore = (prefix: string) => {
    if (process.env.NODE_ENV === "test") {
        return undefined;
    }

    return new RedisStore({
        sendCommand: (...args: string[]) => redis.call(args[0], ...args.slice(1)) as Promise<any>,
        prefix,
    });
};

export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore("rl:auth:"),
    message: {
        success: false,
        error: {
            code: 429,
            message: MESSAGES.ERRORS.TOO_MANY_AUTH_ATTEMPTS,
        },
    },
});

export const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore("rl:forgot-password:"),
    message: {
        success: false,
        error: {
            code: 429,
            message: MESSAGES.ERRORS.TOO_MANY_RESET_REQUESTS,
        },
    },
});

