import { Worker, Job } from "bullmq";
import pool from "@/config/db";
import { redis } from "@/config/redis";
import { bullmqRedisConnection } from "@/jobs/import.queue";
import { ImportJobPayload, ImportJobProgress, ImportMovieItem, ImportFailedItem, ImportCustomList, ImportJobStatus } from "@/types/import.types";
import { tmdbService } from "@/services/tmdb.service";
import { spotifyImportService } from "@/services/spotifyImport.service";
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
/**
 * Processes a Spotify playlist import job.
 */
const processSpotifyImportJob = async (job: Job<ImportJobPayload>): Promise<void> => {
    const { jobId, userId, totalItems } = job.data;
    console.log(`[Spotify Import Worker] Starting Spotify import job ${jobId} for user ${userId} (${totalItems} playlists)`);

    const rawPayload = await redis.get(`import:items:${jobId}`);
    if (!rawPayload) {
        console.error(`[Spotify Import Worker] No items found in Redis for job ${jobId}`);
        await updateJobProgress(jobId, { status: "failed" });
        return;
    }

    let playlistIds: string[] = [];
    try {
        const parsed = JSON.parse(rawPayload);
        playlistIds = parsed.playlistIds || [];
    } catch (err) {
        console.error(`[Spotify Import Worker] Failed to parse items for job ${jobId}`, err);
        await updateJobProgress(jobId, { status: "failed" });
        return;
    }

    await updateJobProgress(jobId, { status: "processing" });

    let processedPlaylists = 0;
    let successfulPlaylists = 0;
    let failedPlaylists = 0;
    let totalTracksImported = 0;
    const errors: ImportFailedItem[] = [];

    for (const playlistId of playlistIds) {
        try {
            console.log(`[Spotify Import Worker] Fetching playlist ${playlistId} for user ${userId}...`);
            const playlistData = await spotifyImportService.fetchSpotifyPlaylist(playlistId);

            console.log(`[Spotify Import Worker] Persisting playlist "${playlistData.name}" (${playlistData.tracks.length} tracks)...`);
            const { tracksCount } = await spotifyImportService.persistSpotifyPlaylist(userId, playlistData);

            successfulPlaylists++;
            totalTracksImported += tracksCount;
        } catch (err: any) {
            console.error(`[Spotify Import Worker] Error importing playlist ${playlistId}:`, err);
            failedPlaylists++;
            errors.push({
                playlist: playlistId,
                error: err.message || "Failed to import playlist",
            });
        } finally {
            processedPlaylists++;
            await updateJobProgress(jobId, {
                processedItems: processedPlaylists,
                successCount: successfulPlaylists,
                failedCount: failedPlaylists,
                playlistsCount: successfulPlaylists,
                tracksCount: totalTracksImported,
                errors: errors.slice(-20),
            });
        }
    }

    const finalStatus: ImportJobStatus = successfulPlaylists > 0 ? "completed" : "failed";
    await updateJobProgress(jobId, {
        status: finalStatus,
        completedAt: new Date().toISOString(),
    });

    // Send push notification
    try {
        if (finalStatus === "completed") {
            await sendPushNotification(userId, {
                localized: {
                    tr: {
                        title: "Spotify Çalma Listesi Aktarımı Tamamlandı",
                        body: `${successfulPlaylists} çalma listesi ve ${totalTracksImported} parça başarıyla içe aktarıldı.`,
                    },
                    en: {
                        title: "Spotify Import Completed",
                        body: `Successfully imported ${successfulPlaylists} playlist(s) and ${totalTracksImported} track(s).`,
                    },
                },
                data: {
                    type: "spotify_import_completed",
                    jobId,
                    playlistsCount: String(successfulPlaylists),
                    tracksCount: String(totalTracksImported),
                },
            });
        } else {
            await sendPushNotification(userId, {
                localized: {
                    tr: {
                        title: "Spotify İçe Aktarma Başarısız Oldu",
                        body: "Çalma listeleri aktarılırken bir hata oluştu. Lütfen bağlantıları kontrol edip tekrar deneyin.",
                    },
                    en: {
                        title: "Spotify Import Failed",
                        body: "Failed to import Spotify playlists. Please check your links and try again.",
                    },
                },
                data: {
                    type: "spotify_import_failed",
                    jobId,
                },
            });
        }
    } catch (notifyErr) {
        console.error(`[Spotify Import Worker] Push notification failed:`, notifyErr);
    }
};

/**
 * Initializes BullMQ worker for Letterboxd & Spotify imports.
 */
export const initImportWorker = (): Worker<ImportJobPayload> => {
    if (importWorker) return importWorker;

    importWorker = new Worker<ImportJobPayload>(
        "letterboxd-import",
        async (job: Job<ImportJobPayload>) => {
            const { jobId, userId, totalItems } = job.data;

            // Route Spotify import jobs
            if (job.name === "import-spotify" || job.data.type === "spotify") {
                await processSpotifyImportJob(job);
                return;
            }

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

            let items: ImportMovieItem[] = [];
            let lists: ImportCustomList[] = [];
            try {
                const parsed = JSON.parse(rawItems);
                if (Array.isArray(parsed)) {
                    items = parsed;
                } else {
                    items = parsed.items || [];
                    lists = parsed.lists || [];
                }
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
            let watchedCount = 0;
            let watchlistCount = 0;
            let listsCount = 0;
            const errors: ImportFailedItem[] = [];

            // 1. Process movie items
            for (const item of items) {
                try {
                    const result = await processMovieItem(userId, item);
                    successCount++;
                    if (result.addedToWatched) watchedCount++;
                    if (result.addedToWatchlist) watchlistCount++;
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

                    // Update progress periodically (every 10 items or on last movie)
                    if (processedCount % 10 === 0 || processedCount === items.length) {
                        await updateJobProgress(jobId, {
                            processedItems: processedCount,
                            successCount,
                            failedCount,
                            watchedCount,
                            watchlistCount,
                            listsCount,
                            errors: errors.slice(-50), // Keep up to 50 errors
                        });
                    }
                }
            }

            // 2. Process custom lists (/lists/*.csv)
            for (const customList of lists) {
                try {
                    await processCustomList(userId, customList, errors);
                    listsCount++;
                    successCount++;
                } catch (err: any) {
                    failedCount++;
                    console.error(`[Import Worker] Failed to process list "${customList.title}":`, err.message);
                    errors.push({
                        movie: customList.title,
                        error: err.message || "Failed to create list",
                    });
                } finally {
                    processedCount++;
                    await updateJobProgress(jobId, {
                        processedItems: processedCount,
                        successCount,
                        failedCount,
                        watchedCount,
                        watchlistCount,
                        listsCount,
                        errors: errors.slice(-50),
                    });
                }
            }

            // Cleanup temporary items key and mark completed
            await redis.del(`import:items:${jobId}`);
            await updateJobProgress(jobId, {
                status: "completed",
                processedItems: processedCount,
                successCount,
                failedCount,
                watchedCount,
                watchlistCount,
                listsCount,
                errors: errors.slice(-50),
                completedAt: new Date().toISOString(),
            });

            // Invalidate user profile cache once at the end of the entire import
            await invalidateUserProfile(userId);

            // Send push notification to user upon completion
            try {
                const partsTr: string[] = [];
                const partsEn: string[] = [];

                if (watchedCount > 0) {
                    partsTr.push(`${watchedCount} film izleme geçmişinize`);
                    partsEn.push(`${watchedCount} movies to watch history`);
                }
                if (watchlistCount > 0) {
                    partsTr.push(`${watchlistCount} film izleme listenize`);
                    partsEn.push(`${watchlistCount} movies to watchlist`);
                }
                if (listsCount > 0) {
                    partsTr.push(`${listsCount} liste profilinize`);
                    partsEn.push(`${listsCount} lists to your profile`);
                }

                let trBody = "";
                let enBody = "";

                if (partsTr.length > 0) {
                    trBody = `${partsTr.join(", ")} eklendi.`;
                    enBody = `Added ${partsEn.join(", ")}.`;
                } else {
                    trBody = `${successCount} öğe başarıyla kütüphanenize eklendi.`;
                    enBody = `${successCount} items were successfully added to your library.`;
                }

                if (failedCount > 0) {
                    trBody += ` (${failedCount} öğe eklenemedi)`;
                    enBody += ` (${failedCount} skipped)`;
                }

                await sendPushNotification(userId, {
                    localized: {
                        tr: {
                            title: "Letterboxd İçe Aktarma Tamamlandı",
                            body: trBody,
                        },
                        en: {
                            title: "Letterboxd Import Completed",
                            body: enBody,
                        },
                    },
                    data: {
                        type: "import_completed",
                        jobId,
                        successCount,
                        failedCount,
                        watchedCount,
                        watchlistCount,
                        listsCount,
                    },
                });
            } catch (notifyErr) {
                console.error(`[Import Worker] Failed to send push notification for job ${jobId}:`, notifyErr);
            }

            console.log(
                `[Import Worker] Finished job ${jobId}. Processed: ${processedCount}, Success: ${successCount} (Watched: ${watchedCount}, Watchlist: ${watchlistCount}, Lists: ${listsCount}), Failed: ${failedCount}`,
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
 * Resolves a movie's ID using local DB lookup or TMDB search.
 */
const resolveMovieId = async (name: string, year: number | null): Promise<string> => {
    // 1. Local DB lookup
    if (year) {
        const exactMatch = await pool.query<{ id: string }>(
            `SELECT id FROM "Movie"
             WHERE LOWER(title) = LOWER($1) AND EXTRACT(YEAR FROM "releaseDate") = $2
             LIMIT 1`,
            [name, year],
        );

        if (exactMatch.rows.length > 0) {
            return exactMatch.rows[0].id;
        }

        // Fallback: +/- 1 year tolerance
        const toleranceMatch = await pool.query<{ id: string }>(
            `SELECT id FROM "Movie"
             WHERE LOWER(title) = LOWER($1) AND ABS(EXTRACT(YEAR FROM "releaseDate") - $2) <= 1
             LIMIT 1`,
            [name, year],
        );
        if (toleranceMatch.rows.length > 0) {
            return toleranceMatch.rows[0].id;
        }
    } else {
        const titleMatch = await pool.query<{ id: string }>(
            `SELECT id FROM "Movie"
             WHERE LOWER(title) = LOWER($1)
             LIMIT 1`,
            [name],
        );
        if (titleMatch.rows.length > 0) {
            return titleMatch.rows[0].id;
        }
    }

    // 2. TMDB Fallback if not found locally
    await tmdbLimiter.acquire();
    const tmdbMovieResult = await tmdbService.searchMovieWithTolerance(name, year);

    if (!tmdbMovieResult) {
        throw new Error(`Movie "${name}" (${year ?? "unknown year"}) not found on TMDB`);
    }

    // Check if TMDB movie already exists in local DB by tmdbId
    const existingTmdb = await pool.query<{ id: string }>(
        `SELECT id FROM "Movie" WHERE "tmdbId" = $1 LIMIT 1`,
        [tmdbMovieResult.id],
    );

    if (existingTmdb.rows.length > 0) {
        return existingTmdb.rows[0].id;
    }

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

    return insertResult.rows[0].id;
};

interface ProcessMovieResult {
    addedToWatched: boolean;
    addedToWatchlist: boolean;
}

/**
 * Processes a single movie item: matches local DB or TMDB, creates/upserts Watched, Watchlist, Interaction, and Comment.
 */
const processMovieItem = async (userId: string, item: ImportMovieItem): Promise<ProcessMovieResult> => {
    const movieId = await resolveMovieId(item.name, item.year);

    // 3. WatchedMovie record(s)
    let addedToWatched = false;
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
        addedToWatched = true;
    }

    // 4. Watchlist record
    let addedToWatchlist = false;
    if (item.inWatchlist) {
        await pool.query(movieQueries.movies.watchlist.add, [
            userId,
            movieId,
            item.watchlistDate || null,
        ]);
        addedToWatchlist = true;
    }

    // 5. Interaction (rating, isLiked) & Comment (review)
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

        // 6. Review / Comment
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

    return { addedToWatched, addedToWatchlist };
};

/**
 * Processes a custom list: finds or creates the list in MovieList table,
 * resolves each movie and inserts into MovieListItem preserving position ordering.
 */
const processCustomList = async (
    userId: string,
    customList: ImportCustomList,
    errors: ImportFailedItem[],
): Promise<void> => {
    const title = customList.title.trim().slice(0, 255);
    const description = customList.description ? customList.description.trim() : null;
    const listDate = customList.createdAt || null;

    // Check if a custom list with the same title already exists for this user
    const existingList = await pool.query<{ id: string }>(
        `SELECT id FROM "MovieList" WHERE "creatorId" = $1 AND "title" = $2 AND "listType" = 'custom' LIMIT 1`,
        [userId, title],
    );

    let listId: string;
    if (existingList.rows.length > 0) {
        listId = existingList.rows[0].id;
    } else {
        const newList = await pool.query<{ id: string }>(
            `INSERT INTO "MovieList" (id, title, description, image, "isPrivate", "listType", "creatorId", "createdAt", "updatedAt")
             VALUES (gen_random_uuid(), $1, $2, null, false, 'custom', $3, COALESCE($4::TIMESTAMPTZ, NOW()), NOW())
             RETURNING id`,
            [title, description, userId, listDate],
        );
        listId = newList.rows[0].id;
    }

    // Base timestamp for preserving list position order
    const baseTime = listDate ? new Date(listDate).getTime() : Date.now();

    // Process each movie in the list
    for (let idx = 0; idx < customList.movies.length; idx++) {
        const m = customList.movies[idx];
        try {
            const movieId = await resolveMovieId(m.name, m.year);
            const position = m.position ?? idx + 1;
            // Stagger addedAt by position seconds to guarantee deterministic order
            const itemAddedAt = new Date(baseTime + position * 1000).toISOString();

            await pool.query(movieQueries.lists.items.addMovie, [
                listId,
                movieId,
                userId,
                itemAddedAt,
            ]);
        } catch (err: any) {
            console.error(`[Import Worker] Failed to add movie "${m.name}" to list "${title}":`, err.message);
            errors.push({
                movie: `${title} > ${m.name}`,
                year: m.year,
                error: err.message || "Failed to resolve movie for list",
            });
        }
    }
};
