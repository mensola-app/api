import { Worker, Job } from "bullmq";
import pool from "@/config/db";
import { redis } from "@/config/redis";
import { bullmqRedisConnection } from "@/jobs/import.queue";
import { ImportJobPayload, ImportJobProgress, ImportMovieItem, ImportFailedItem } from "@/types/import.types";
import { tmdbService } from "@/services/tmdb.service";
import { movieQueries } from "@/queries/movie.queries";
import { invalidateUserProfile } from "@/utils/cache";
import { sendPushNotification } from "@/utils/pushNotification";

const JOB_PROGRESS_TTL = 86400; // 24 hours

/**
 * Token bucket rate limiter to throttle TMDB requests (max 15 req/sec).
 */
class RateLimiter {
    private maxTokens: number;
    private tokens: number;
    private intervalMs: number;
    private lastRefill: number;
    private queue: Array<() => void> = [];

    constructor(maxTokens: number, intervalMs: number) {
        this.maxTokens = maxTokens;
        this.tokens = maxTokens;
        this.intervalMs = intervalMs;
        this.lastRefill = Date.now();
    }

    private refill() {
        const now = Date.now();
        const timePassed = now - this.lastRefill;
        if (timePassed >= this.intervalMs) {
            this.tokens = this.maxTokens;
            this.lastRefill = now;
        }
    }

    async acquire(): Promise<void> {
        this.refill();
        if (this.tokens > 0) {
            this.tokens--;
            return;
        }

        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
            const waitTime = Math.max(50, this.intervalMs - (Date.now() - this.lastRefill));
            setTimeout(() => {
                this.refill();
                while (this.tokens > 0 && this.queue.length > 0) {
                    this.tokens--;
                    const next = this.queue.shift();
                    if (next) next();
                }
            }, waitTime);
        });
    }
}

// 15 requests per 1000ms
const tmdbLimiter = new RateLimiter(15, 1000);

export let importWorker: Worker<ImportJobPayload> | null = null;

/**
 * Initializes BullMQ worker for Letterboxd imports.
 */
export const initImportWorker = (): Worker<ImportJobPayload> => {
    if (importWorker) return importWorker;

    importWorker = new Worker<ImportJobPayload>(
        "letterboxd-import",
        async (job: Job<ImportJobPayload>) => {
            const { jobId, userId, totalItems } = job.data;
            console.log(`[Import Worker] Starting import job ${jobId} for user ${userId} (${totalItems} items)`);

            // Fetch items from Redis
            const rawItems = await redis.get(`import:items:${jobId}`);
            if (!rawItems) {
                console.error(`[Import Worker] No items found in Redis for job ${jobId}`);
                await updateJobProgress(jobId, { status: "failed" });
                try {
                    await sendPushNotification(userId, {
                        localized: {
                            tr: {
                                title: "Letterboxd İçe Aktarma Başarısız Oldu",
                                body: "İçe aktarma sırasında bir hata oluştu. Lütfen tekrar deneyin.",
                            },
                            en: {
                                title: "Letterboxd Import Failed",
                                body: "An error occurred during import. Please try again.",
                            },
                        },
                        data: { type: "import_failed", jobId },
                    });
                } catch {}
                return;
            }

            let items: ImportMovieItem[];
            try {
                items = JSON.parse(rawItems);
            } catch (err) {
                console.error(`[Import Worker] Failed to parse items for job ${jobId}`, err);
                await updateJobProgress(jobId, { status: "failed" });
                try {
                    await sendPushNotification(userId, {
                        localized: {
                            tr: {
                                title: "Letterboxd İçe Aktarma Başarısız Oldu",
                                body: "İçe aktarma sırasında bir hata oluştu. Lütfen tekrar deneyin.",
                            },
                            en: {
                                title: "Letterboxd Import Failed",
                                body: "An error occurred during import. Please try again.",
                            },
                        },
                        data: { type: "import_failed", jobId },
                    });
                } catch {}
                return;
            }

            await updateJobProgress(jobId, { status: "processing" });

            let processedCount = 0;
            let successCount = 0;
            let failedCount = 0;
            const errors: ImportFailedItem[] = [];

            for (const item of items) {
                try {
                    await processMovieItem(userId, item);
                    successCount++;
                } catch (err: any) {
                    failedCount++;
                    console.error(`[Import Worker] Failed to process movie "${item.name}" (${item.year}):`, err.message);
                    errors.push({
                        movie: item.name,
                        year: item.year,
                        error: err.message || "Unknown error",
                    });
                } finally {
                    processedCount++;

                    // Update progress periodically (every 10 items or on last item)
                    if (processedCount % 10 === 0 || processedCount === items.length) {
                        await updateJobProgress(jobId, {
                            processedItems: processedCount,
                            successCount,
                            failedCount,
                            errors: errors.slice(-50), // Keep up to 50 errors
                        });
                    }
                }
            }

            // Cleanup temporary items key and mark completed
            await redis.del(`import:items:${jobId}`);
            await updateJobProgress(jobId, {
                status: "completed",
                processedItems: processedCount,
                successCount,
                failedCount,
                errors: errors.slice(-50),
                completedAt: new Date().toISOString(),
            });

            // Invalidate user profile cache once at the end of the entire import
            await invalidateUserProfile(userId);

            // Send push notification to user upon completion
            try {
                await sendPushNotification(userId, {
                    localized: {
                        tr: {
                            title: "Letterboxd İçe Aktarma Tamamlandı",
                            body:
                                failedCount > 0
                                    ? `${successCount} film kütüphanenize eklendi, ${failedCount} film eklenemedi.`
                                    : `${successCount} film başarıyla kütüphanenize eklendi.`,
                        },
                        en: {
                            title: "Letterboxd Import Completed",
                            body:
                                failedCount > 0
                                    ? `${successCount} movies added, ${failedCount} skipped.`
                                    : `${successCount} movies were successfully added to your library.`,
                        },
                    },
                    data: {
                        type: "import_completed",
                        jobId,
                        successCount,
                        failedCount,
                    },
                });
            } catch (notifyErr) {
                console.error(`[Import Worker] Failed to send push notification for job ${jobId}:`, notifyErr);
            }

            console.log(
                `[Import Worker] Finished job ${jobId}. Processed: ${processedCount}, Success: ${successCount}, Failed: ${failedCount}`,
            );
        },
        {
            connection: bullmqRedisConnection,
            concurrency: 2, // Concurrency across jobs
        },
    );

    importWorker.on("failed", async (job, err) => {
        console.error(`[Import Worker] Job ${job?.id} failed:`, err);
        if (job?.data?.userId) {
            try {
                await sendPushNotification(job.data.userId, {
                    localized: {
                        tr: {
                            title: "Letterboxd İçe Aktarma Başarısız Oldu",
                            body: "İçe aktarma sırasında bir hata oluştu. Lütfen tekrar deneyin.",
                        },
                        en: {
                            title: "Letterboxd Import Failed",
                            body: "An error occurred during import. Please try again.",
                        },
                    },
                    data: {
                        type: "import_failed",
                        jobId: job.data.jobId,
                    },
                });
            } catch (notifyErr) {
                console.error(`[Import Worker] Failed to send push notification for failed job ${job?.id}:`, notifyErr);
            }
        }
    });

    importWorker.on("error", (err) => {
        console.error("[Import Worker] Worker encountered error:", err);
    });

    return importWorker;
};

/**
 * Updates import job progress in Redis.
 */
const updateJobProgress = async (jobId: string, updates: Partial<ImportJobProgress>): Promise<void> => {
    try {
        const key = `import:job:${jobId}`;
        const existing = await redis.get(key);
        if (!existing) return;

        const current: ImportJobProgress = JSON.parse(existing);
        const updated: ImportJobProgress = {
            ...current,
            ...updates,
            updatedAt: new Date().toISOString(),
        };

        await redis.set(key, JSON.stringify(updated), "EX", JOB_PROGRESS_TTL);
    } catch (err) {
        console.error(`[Import Worker] Failed to update progress for job ${jobId}:`, err);
    }
};

/**
 * Processes a single movie item: matches local DB or TMDB, creates/upserts Watched, Interaction, and Comment.
 */
const processMovieItem = async (userId: string, item: ImportMovieItem): Promise<void> => {
    let movieId: string | null = null;

    // 1. Local DB lookup
    if (item.year) {
        const exactMatch = await pool.query<{ id: string }>(
            `SELECT id FROM "Movie"
             WHERE LOWER(title) = LOWER($1) AND EXTRACT(YEAR FROM "releaseDate") = $2
             LIMIT 1`,
            [item.name, item.year],
        );

        if (exactMatch.rows.length > 0) {
            movieId = exactMatch.rows[0].id;
        } else {
            // Fallback: +/- 1 year tolerance
            const toleranceMatch = await pool.query<{ id: string }>(
                `SELECT id FROM "Movie"
                 WHERE LOWER(title) = LOWER($1) AND ABS(EXTRACT(YEAR FROM "releaseDate") - $2) <= 1
                 LIMIT 1`,
                [item.name, item.year],
            );
            if (toleranceMatch.rows.length > 0) {
                movieId = toleranceMatch.rows[0].id;
            }
        }
    } else {
        const titleMatch = await pool.query<{ id: string }>(
            `SELECT id FROM "Movie"
             WHERE LOWER(title) = LOWER($1)
             LIMIT 1`,
            [item.name],
        );
        if (titleMatch.rows.length > 0) {
            movieId = titleMatch.rows[0].id;
        }
    }

    // 2. TMDB Fallback if not found locally
    if (!movieId) {
        await tmdbLimiter.acquire();
        const tmdbMovieResult = await tmdbService.searchMovieWithTolerance(item.name, item.year);

        if (!tmdbMovieResult) {
            throw new Error(`Movie "${item.name}" (${item.year ?? "unknown year"}) not found on TMDB`);
        }

        // Check if TMDB movie already exists in local DB by tmdbId
        const existingTmdb = await pool.query<{ id: string }>(
            `SELECT id FROM "Movie" WHERE "tmdbId" = $1 LIMIT 1`,
            [tmdbMovieResult.id],
        );

        if (existingTmdb.rows.length > 0) {
            movieId = existingTmdb.rows[0].id;
        } else {
            // Fetch full movie details including credits
            await tmdbLimiter.acquire();
            const tmdbDetails = await tmdbService.getMovieByTmdbId(tmdbMovieResult.id);

            const insertResult = await pool.query<{ id: string }>(movieQueries.movies.insertMovie, [
                tmdbDetails.tmdbId,
                tmdbDetails.title,
                tmdbDetails.poster,
                tmdbDetails.releaseDate || null,
                tmdbDetails.rating || null,
                tmdbDetails.genres || null,
                tmdbDetails.duration || null,
                tmdbDetails.overview || null,
                tmdbDetails.credits ? JSON.stringify(tmdbDetails.credits) : null,
            ]);

            movieId = insertResult.rows[0].id;
        }
    }

    if (!movieId) {
        throw new Error(`Could not resolve movie ID for "${item.name}"`);
    }

    // 3. WatchedMovie record(s)
    if (item.isWatched) {
        const datesToInsert = item.watchedDates.length > 0 ? item.watchedDates : [null];

        // If not a rewatch and has a single date, remove any duplicate watch records for this movie
        if (!item.rewatch && datesToInsert.length === 1) {
            const wDate = datesToInsert[0];
            const existingWatches = await pool.query<{ id: string; watchedAt: Date }>(
                `SELECT id, "watchedAt" FROM "WatchedMovie"
                 WHERE "userId" = $1 AND "movieId" = $2
                 ORDER BY "watchedAt" DESC`,
                [userId, movieId],
            );

            if (existingWatches.rows.length > 1) {
                // Keep the one that matches wDate (or the latest one) and delete the rest
                let keepId = existingWatches.rows[0].id;
                if (wDate) {
                    const match = existingWatches.rows.find(
                        (r) => r.watchedAt && new Date(r.watchedAt).toISOString().split("T")[0] === wDate.split("T")[0],
                    );
                    if (match) keepId = match.id;
                }

                await pool.query(
                    `DELETE FROM "WatchedMovie"
                     WHERE "userId" = $1 AND "movieId" = $2 AND id != $3`,
                    [userId, movieId, keepId],
                );
            }
        }

        for (const wDate of datesToInsert) {
            if (wDate) {
                const existingWatch = await pool.query(
                    `SELECT id FROM "WatchedMovie"
                     WHERE "userId" = $1 AND "movieId" = $2 AND "watchedAt"::date = $3::date
                     LIMIT 1`,
                    [userId, movieId, wDate],
                );
                if (existingWatch.rows.length === 0) {
                    await pool.query(
                        `INSERT INTO "WatchedMovie" (id, "userId", "movieId", "watchedAt")
                         VALUES (gen_random_uuid(), $1, $2, $3::TIMESTAMPTZ)`,
                        [userId, movieId, wDate],
                    );
                }
            } else {
                const existingWatch = await pool.query(
                    `SELECT id FROM "WatchedMovie"
                     WHERE "userId" = $1 AND "movieId" = $2
                     LIMIT 1`,
                    [userId, movieId],
                );
                if (existingWatch.rows.length === 0) {
                    await pool.query(
                        `INSERT INTO "WatchedMovie" (id, "userId", "movieId", "watchedAt")
                         VALUES (gen_random_uuid(), $1, $2, NOW())`,
                        [userId, movieId],
                    );
                }
            }
        }
    }

    // 4. Interaction (rating, isLiked) & Comment (review)
    const hasRating = item.rating !== null && item.rating !== undefined;
    const hasLike = Boolean(item.isLiked);
    const hasReview = Boolean(item.review && item.review.trim().length > 0);

    if (hasRating || hasLike || hasReview) {
        const existingInteraction = await pool.query<{ id: string; rating: number | null; isLiked: boolean }>(
            `SELECT id, rating, "isLiked" FROM "Interaction"
             WHERE "userId" = $1 AND "targetId" = $2 AND "targetType" = 'movie'
             LIMIT 1`,
            [userId, movieId],
        );

        let interactionId: string;

        if (existingInteraction.rows.length > 0) {
            const current = existingInteraction.rows[0];
            interactionId = current.id;

            // Preserve existing rating if present, otherwise set imported rating
            const finalRating = current.rating !== null ? current.rating : (item.rating ?? null);
            const finalIsLiked = current.isLiked || hasLike;

            await pool.query(
                `UPDATE "Interaction"
                 SET "rating" = $1, "isLiked" = $2, "updatedAt" = NOW()
                 WHERE id = $3`,
                [finalRating, finalIsLiked, interactionId],
            );
        } else {
            const insertInteraction = await pool.query<{ id: string }>(
                `INSERT INTO "Interaction" (id, "userId", "targetId", "targetType", "rating", "isLiked", "interactedAt", "updatedAt")
                 VALUES (gen_random_uuid(), $1, $2, 'movie', $3, $4, NOW(), NOW())
                 RETURNING id`,
                [userId, movieId, item.rating ?? null, hasLike],
            );
            interactionId = insertInteraction.rows[0].id;
        }

        // 5. Review / Comment
        if (hasReview && item.review) {
            const existingComment = await pool.query(
                `SELECT id FROM "Comment"
                 WHERE "interactionId" = $1 AND "parentId" IS NULL
                 LIMIT 1`,
                [interactionId],
            );

            // Don't overwrite existing user comment
            if (existingComment.rows.length === 0) {
                const commentDate = item.watchedDates[0] || null;
                await pool.query(
                    `INSERT INTO "Comment" (id, "userId", "interactionId", "content", "createdAt")
                     VALUES (gen_random_uuid(), $1, $2, $3, COALESCE($4::TIMESTAMPTZ, NOW()))`,
                    [userId, interactionId, item.review, commentDate],
                );
            }
        }
    }
};
