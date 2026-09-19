import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: process.env.NODE_ENV === "test",
    retryStrategy(times) {
        if (process.env.NODE_ENV === "test") {
            return null;
        }
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
});

redis.on("connect", () => {
    if (process.env.NODE_ENV !== "test") {
        console.log("✅ Redis connected successfully");
    }
});

redis.on("error", (err) => {
    if (process.env.NODE_ENV !== "test") {
        console.error("❌ Redis connection error:", err.message);
    }
});

