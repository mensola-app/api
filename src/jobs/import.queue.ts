import { Queue } from "bullmq";
import { ImportJobPayload } from "@/types/import.types";
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// BullMQ requires maxRetriesPerRequest: null
export const bullmqRedisConnection = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: process.env.NODE_ENV === "test",
    retryStrategy(times) {
        if (process.env.NODE_ENV === "test") {
            return null;
        }
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
});

export const importQueue = new Queue<ImportJobPayload>("letterboxd-import", {
    connection: bullmqRedisConnection,
    defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
    },
});
