import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { nanoid } from "nanoid";
import {
    ImportMovieItem,
    ImportResponseDto,
    ImportJobProgress,
    LetterboxdDiaryRow,
    LetterboxdWatchedRow,
    LetterboxdRatingRow,
    LetterboxdReviewRow,
    LetterboxdLikeRow,
} from "@/types/import.types";
import { ApiError } from "@/utils/error";
import { redis } from "@/config/redis";
import { importQueue } from "@/jobs/import.queue";

const JOB_PROGRESS_TTL = 86400; // 24 hours
const JOB_ITEMS_TTL = 86400; // 24 hours

/**
 * Strips HTML tags and decodes common HTML entities from review text.
 */
export const sanitizeHtml = (html?: string | null): string => {
    if (!html) return "";

    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .trim();
};

/**
 * Normalizes movie key for de-duplication using name + year.
 */
const getMovieKey = (name: string, year?: string | number | null): string => {
    const cleanName = name.trim().toLowerCase();
    const cleanYear = year ? String(year).trim() : "";
    return `${cleanName}_${cleanYear}`;
};

/**
 * Helper to get or match an existing movie item in movieMap,
 * handling cases where year might be missing in one file but present in another.
 */
const getOrFindMovie = (
    movieMap: Map<string, ImportMovieItem>,
    name: string,
    year?: number | null,
): { key: string; item?: ImportMovieItem } => {
    const key = getMovieKey(name, year);
    const exact = movieMap.get(key);
    if (exact) return { key, item: exact };

    // If year is not specified, check if this movie already exists with a year
    if (!year) {
        const cleanName = name.trim().toLowerCase();
        for (const [existingKey, existingItem] of movieMap.entries()) {
            if (existingItem.name.trim().toLowerCase() === cleanName) {
                return { key: existingKey, item: existingItem };
            }
        }
    } else {
        // If year is specified, check if it was previously added without a year
        const cleanName = name.trim().toLowerCase();
        const withoutYearKey = `${cleanName}_`;
        const existingWithoutYear = movieMap.get(withoutYearKey);
        if (existingWithoutYear) {
            movieMap.delete(withoutYearKey);
            existingWithoutYear.year = year;
            movieMap.set(key, existingWithoutYear);
            return { key, item: existingWithoutYear };
        }
    }

    return { key };
};

export const importService = {
    /**
     * Validates and parses Letterboxd export ZIP archive in-memory.
     * Merges diary, reviews, likes, watched, and ratings with de-duplication.
     * Prioritizes diary.csv Watched Date; avoids duplicate watch dates across CSVs.
     */
    validateAndParseZip: (buffer: Buffer): { items: ImportMovieItem[]; totalItems: number } => {
        let zip: AdmZip;
        try {
            zip = new AdmZip(buffer);
        } catch {
            throw new ApiError("INVALID_ZIP_FILE", 400);
        }

        const entries = zip.getEntries();

        // Helper to find entry matching regex, ignoring __MACOSX and hidden files
        const findEntry = (pattern: RegExp) => {
            return entries.find(
                (e) => !e.isDirectory && !e.entryName.includes("__MACOSX") && !e.name.startsWith("._") && pattern.test(e.entryName),
            );
        };

        const diaryEntry = findEntry(/(^|\/)diary\.csv$/i);
        const watchedEntry = findEntry(/(^|\/)watched\.csv$/i);
        const ratingsEntry = findEntry(/(^|\/)ratings\.csv$/i);
        const reviewsEntry = findEntry(/(^|\/)reviews\.csv$/i);
        const likesEntry = findEntry(/(^|\/)likes\/films\.csv$/i);

        // ZIP must contain at least watched.csv, ratings.csv, or diary.csv
        if (!watchedEntry && !ratingsEntry && !diaryEntry) {
            throw new ApiError("INVALID_LETTERBOXD_ZIP", 400);
        }

        const parseCsv = <T>(entry?: AdmZip.IZipEntry): T[] => {
            if (!entry) return [];
            try {
                const content = entry.getData().toString("utf-8");
                return parse(content, {
                    columns: true,
                    skip_empty_lines: true,
                    trim: true,
                    relax_column_count: true,
                }) as T[];
            } catch (err) {
                console.error(`[CSV Parse Error] entry: ${entry.entryName}`, err);
                return [];
            }
        };

        const diaryRows = parseCsv<LetterboxdDiaryRow>(diaryEntry);
        const reviewsRows = parseCsv<LetterboxdReviewRow>(reviewsEntry);
        const likesRows = parseCsv<LetterboxdLikeRow>(likesEntry);
        const watchedRows = parseCsv<LetterboxdWatchedRow>(watchedEntry);
        const ratingsRows = parseCsv<LetterboxdRatingRow>(ratingsEntry);

        const movieMap = new Map<string, ImportMovieItem>();
        const moviesWithDiary = new Set<string>();

        // 1. diary.csv (highest priority for watch history and Watched Date)
        for (const row of diaryRows) {
            if (!row.Name) continue;
            const yearNum = row.Year ? parseInt(row.Year, 10) : null;
            const year = !isNaN(Number(yearNum)) ? yearNum : null;
            const { key, item: existing } = getOrFindMovie(movieMap, row.Name, year);

            moviesWithDiary.add(key);

            const rawRating = row.Rating ? parseFloat(row.Rating) : NaN;
            const rating = !isNaN(rawRating) ? Math.min(10, Math.max(0, rawRating * 2)) : null;
            const watchDate = row["Watched Date"]?.trim() || row.Date?.trim() || null;
            const isRewatch = row.Rewatch?.toLowerCase() === "yes";

            if (existing) {
                if (watchDate && !existing.watchedDates.includes(watchDate)) {
                    existing.watchedDates.push(watchDate);
                }
                if (rating !== null && existing.rating === null) {
                    existing.rating = rating;
                }
                if (isRewatch) {
                    existing.rewatch = true;
                }
                existing.isWatched = true;
            } else {
                movieMap.set(key, {
                    name: row.Name.trim(),
                    year,
                    letterboxdUri: row["Letterboxd URI"],
                    rating,
                    review: null,
                    rewatch: isRewatch,
                    isLiked: false,
                    watchedDates: watchDate ? [watchDate] : [],
                    isWatched: true,
                });
            }
        }

        // 2. reviews.csv (review text, rating, and watch date if not in diary)
        for (const row of reviewsRows) {
            if (!row.Name) continue;
            const yearNum = row.Year ? parseInt(row.Year, 10) : null;
            const year = !isNaN(Number(yearNum)) ? yearNum : null;
            const { key, item: existing } = getOrFindMovie(movieMap, row.Name, year);

            const rawRating = row.Rating ? parseFloat(row.Rating) : NaN;
            const rating = !isNaN(rawRating) ? Math.min(10, Math.max(0, rawRating * 2)) : null;
            const cleanReview = sanitizeHtml(row.Review);
            const watchDate = row["Watched Date"]?.trim() || row.Date?.trim() || null;
            const isRewatch = row.Rewatch?.toLowerCase() === "yes";
            const hasDiary = moviesWithDiary.has(key);

            if (existing) {
                // If movie was in diary.csv, DO NOT add review date to watchedDates
                if (!hasDiary && watchDate && !existing.watchedDates.includes(watchDate)) {
                    existing.watchedDates.push(watchDate);
                }
                if (rating !== null && existing.rating === null) {
                    existing.rating = rating;
                }
                if (cleanReview && !existing.review) {
                    existing.review = cleanReview;
                }
                if (isRewatch) {
                    existing.rewatch = true;
                }
                existing.isWatched = true;
            } else {
                movieMap.set(key, {
                    name: row.Name.trim(),
                    year,
                    letterboxdUri: row["Letterboxd URI"],
                    rating,
                    review: cleanReview || null,
                    rewatch: isRewatch,
                    isLiked: false,
                    watchedDates: (!hasDiary && watchDate) ? [watchDate] : [],
                    isWatched: true,
                });
            }
        }

        // 3. likes/films.csv (sets isLiked: true, and isWatched: true)
        for (const row of likesRows) {
            if (!row.Name) continue;
            const yearNum = row.Year ? parseInt(row.Year, 10) : null;
            const year = !isNaN(Number(yearNum)) ? yearNum : null;
            const { key, item: existing } = getOrFindMovie(movieMap, row.Name, year);

            if (existing) {
                existing.isLiked = true;
                existing.isWatched = true;
            } else {
                movieMap.set(key, {
                    name: row.Name.trim(),
                    year,
                    letterboxdUri: row["Letterboxd URI"],
                    rating: null,
                    review: null,
                    rewatch: false,
                    isLiked: true,
                    watchedDates: [],
                    isWatched: true,
                });
            }
        }

        // 4. watched.csv (adds movies not found above, sets watch date if not already set)
        for (const row of watchedRows) {
            if (!row.Name) continue;
            const yearNum = row.Year ? parseInt(row.Year, 10) : null;
            const year = !isNaN(Number(yearNum)) ? yearNum : null;
            const { key, item: existing } = getOrFindMovie(movieMap, row.Name, year);

            const watchDate = row.Date?.trim() || null;
            const hasDiary = moviesWithDiary.has(key);

            if (existing) {
                existing.isWatched = true;
                // Only set date if movie is not in diary AND has no watch date yet
                if (!hasDiary && existing.watchedDates.length === 0 && watchDate) {
                    existing.watchedDates.push(watchDate);
                }
                if (row["Letterboxd URI"]) {
                    existing.letterboxdUri = row["Letterboxd URI"];
                }
            } else {
                movieMap.set(key, {
                    name: row.Name.trim(),
                    year,
                    letterboxdUri: row["Letterboxd URI"],
                    rating: null,
                    review: null,
                    rewatch: false,
                    isLiked: false,
                    watchedDates: (!hasDiary && watchDate) ? [watchDate] : [],
                    isWatched: true,
                });
            }
        }

        // 5. ratings.csv (fills missing ratings, sets date if not already set)
        for (const row of ratingsRows) {
            if (!row.Name) continue;
            const yearNum = row.Year ? parseInt(row.Year, 10) : null;
            const year = !isNaN(Number(yearNum)) ? yearNum : null;
            const { key, item: existing } = getOrFindMovie(movieMap, row.Name, year);

            const rawRating = row.Rating ? parseFloat(row.Rating) : NaN;
            const rating = !isNaN(rawRating) ? Math.min(10, Math.max(0, rawRating * 2)) : null;
            const watchDate = row.Date?.trim() || null;
            const hasDiary = moviesWithDiary.has(key);

            if (existing) {
                existing.isWatched = true;
                if (rating !== null && existing.rating === null) {
                    existing.rating = rating;
                }
                // Only set date if movie is not in diary AND has no watch date yet
                if (!hasDiary && existing.watchedDates.length === 0 && watchDate) {
                    existing.watchedDates.push(watchDate);
                }
                if (row["Letterboxd URI"]) {
                    existing.letterboxdUri = row["Letterboxd URI"];
                }
            } else {
                movieMap.set(key, {
                    name: row.Name.trim(),
                    year,
                    letterboxdUri: row["Letterboxd URI"],
                    rating,
                    review: null,
                    rewatch: false,
                    isLiked: false,
                    watchedDates: (!hasDiary && watchDate) ? [watchDate] : [],
                    isWatched: true,
                });
            }
        }

        const items = Array.from(movieMap.values());
        return { items, totalItems: items.length };
    },

    /**
     * Creates an import job, stores items and metadata in Redis, and enqueues to BullMQ.
     */
    createImportJob: async (userId: string, items: ImportMovieItem[]): Promise<ImportResponseDto> => {
        const jobId = nanoid();
        const now = new Date().toISOString();

        const progress: ImportJobProgress = {
            jobId,
            userId,
            status: "queued",
            totalItems: items.length,
            processedItems: 0,
            successCount: 0,
            failedCount: 0,
            createdAt: now,
            updatedAt: now,
        };

        // 1. Save progress state in Redis
        await redis.set(`import:job:${jobId}`, JSON.stringify(progress), "EX", JOB_PROGRESS_TTL);

        // 2. Save items list in Redis separately (avoiding bloated BullMQ job payload)
        await redis.set(`import:items:${jobId}`, JSON.stringify(items), "EX", JOB_ITEMS_TTL);

        // 3. Enqueue lightweight BullMQ job
        await importQueue.add(
            "import-letterboxd",
            { jobId, userId, totalItems: items.length },
            {
                jobId,
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 100 },
            },
        );

        return {
            jobId,
            status: "queued",
            totalItems: items.length,
        };
    },

    /**
     * Retrieves current progress of an import job from Redis.
     */
    getJobProgress: async (jobId: string): Promise<ImportJobProgress | null> => {
        const data = await redis.get(`import:job:${jobId}`);
        if (!data) return null;
        try {
            return JSON.parse(data) as ImportJobProgress;
        } catch {
            return null;
        }
    },
};
