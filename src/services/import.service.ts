import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { nanoid } from "nanoid";
import {
    ImportMovieItem,
    ImportResponseDto,
    ImportJobProgress,
    ImportCustomList,
    ImportListItemMovie,
    ImportJobItemsPayload,
    LetterboxdDiaryRow,
    LetterboxdWatchedRow,
    LetterboxdRatingRow,
    LetterboxdReviewRow,
    LetterboxdLikeRow,
    LetterboxdWatchlistRow,
    LetterboxdListMetaRow,
    LetterboxdListItemRow,
    SpotifyImportJobItemsPayload,
} from "@/types/import.types";
import { ApiError } from "@/utils/error";
import { redis } from "@/config/redis";
import { importQueue } from "@/jobs/import.queue";
import { parseSpotifyPlaylistId } from "@/utils/spotify.utils";

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

/**
 * Parses a custom list CSV file from the lists/ directory.
 * Extracts list metadata (title, description, date, url) and movie items with position.
 */
export const parseListCsv = (content: string, fallbackTitle: string): ImportCustomList | null => {
    const lines = content.split(/\r?\n/);
    if (lines.length === 0) return null;

    let splitIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "") {
            splitIndex = i;
            break;
        }
    }

    let metaLines = splitIndex !== -1 ? lines.slice(0, splitIndex) : lines;
    const movieLines = splitIndex !== -1 ? lines.slice(splitIndex + 1) : [];

    // Filter out "Letterboxd list export..." header line if present
    metaLines = metaLines.filter((l) => !l.startsWith("Letterboxd list export") && l.trim().length > 0);

    let title = fallbackTitle;
    let description: string | null = null;
    let createdAt: string | null = null;
    let letterboxdUri: string | null = null;

    if (metaLines.length > 0) {
        try {
            const metaRecords = parse(metaLines.join("\n"), {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
            }) as LetterboxdListMetaRow[];

            if (metaRecords.length > 0 && metaRecords[0].Name) {
                title = metaRecords[0].Name.trim();
                description = metaRecords[0].Description?.trim() || null;
                createdAt = metaRecords[0].Date?.trim() || null;
                letterboxdUri = metaRecords[0].URL?.trim() || null;
            }
        } catch {
            // Use fallback title if header parsing fails
        }
    }

    // Parse movie items
    const movies: ImportListItemMovie[] = [];
    const movieContent = movieLines.join("\n").trim();
    if (movieContent.length > 0) {
        try {
            const itemRecords = parse(movieContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
            }) as LetterboxdListItemRow[];

            for (const row of itemRecords) {
                if (!row.Name) continue;
                const yearNum = row.Year ? parseInt(row.Year, 10) : null;
                const year = !isNaN(Number(yearNum)) ? yearNum : null;
                const posNum = row.Position ? parseInt(row.Position, 10) : undefined;
                movies.push({
                    name: row.Name.trim(),
                    year,
                    position: !isNaN(Number(posNum)) ? posNum : undefined,
                    description: row.Description?.trim() || null,
                    url: row.URL?.trim() || undefined,
                });
            }
        } catch (err) {
            console.error(`[List CSV Items Parse Error] title: ${title}`, err);
        }
    }

    return {
        title: title.slice(0, 255), // Truncate title to 255 chars (DB column VARCHAR(255))
        description,
        createdAt,
        letterboxdUri,
        isPrivate: false,
        movies,
    };
};

export const importService = {
    /**
     * Validates and parses Letterboxd export ZIP archive in-memory.
     * Merges diary, reviews, likes, watched, ratings, and custom lists (/lists/*.csv).
     */
    validateAndParseZip: (
        buffer: Buffer,
    ): { items: ImportMovieItem[]; lists: ImportCustomList[]; totalItems: number } => {
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
        const watchlistEntry = findEntry(/(^|\/)watchlist\.csv$/i);

        // Find all custom list files under lists/ directory
        const listEntries = entries.filter(
            (e) =>
                !e.isDirectory &&
                !e.entryName.includes("__MACOSX") &&
                !e.name.startsWith("._") &&
                /(^|\/)lists\/[^/]+\.csv$/i.test(e.entryName),
        );

        // ZIP must contain at least watched, ratings, diary, watchlist, or custom lists
        if (!watchedEntry && !ratingsEntry && !diaryEntry && !watchlistEntry && listEntries.length === 0) {
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
        const watchlistRows = parseCsv<LetterboxdWatchlistRow>(watchlistEntry);

        // Parse custom lists
        const lists: ImportCustomList[] = [];
        for (const entry of listEntries) {
            try {
                const content = entry.getData().toString("utf-8");
                const fallbackTitle = entry.name.replace(/\.csv$/i, "").replace(/[-_]/g, " ").trim();
                const parsedList = parseListCsv(content, fallbackTitle);
                if (parsedList) {
                    lists.push(parsedList);
                }
            } catch (err) {
                console.error(`[List Entry Parse Error] ${entry.entryName}`, err);
            }
        }

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

        // 6. watchlist.csv (adds movies to watchlist, sets inWatchlist: true)
        for (const row of watchlistRows) {
            if (!row.Name) continue;
            const yearNum = row.Year ? parseInt(row.Year, 10) : null;
            const year = !isNaN(Number(yearNum)) ? yearNum : null;
            const { key, item: existing } = getOrFindMovie(movieMap, row.Name, year);

            const watchlistDate = row.Date?.trim() || null;

            if (existing) {
                existing.inWatchlist = true;
                if (watchlistDate && !existing.watchlistDate) {
                    existing.watchlistDate = watchlistDate;
                }
                if (row["Letterboxd URI"] && !existing.letterboxdUri) {
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
                    watchedDates: [],
                    isWatched: false,
                    inWatchlist: true,
                    watchlistDate,
                });
            }
        }

        const items = Array.from(movieMap.values());
        return { items, lists, totalItems: items.length + lists.length };
    },

    /**
     * Creates an import job, stores items and metadata in Redis, and enqueues to BullMQ.
     */
    createImportJob: async (
        userId: string,
        items: ImportMovieItem[],
        lists: ImportCustomList[] = [],
    ): Promise<ImportResponseDto> => {
        const jobId = nanoid();
        const now = new Date().toISOString();
        const totalItems = items.length + lists.length;

        const progress: ImportJobProgress = {
            jobId,
            userId,
            status: "queued",
            totalItems,
            processedItems: 0,
            successCount: 0,
            failedCount: 0,
            watchedCount: 0,
            watchlistCount: 0,
            listsCount: 0,
            createdAt: now,
            updatedAt: now,
        };

        // 1. Save progress state in Redis
        await redis.set(`import:job:${jobId}`, JSON.stringify(progress), "EX", JOB_PROGRESS_TTL);

        // 2. Save items & lists payload in Redis separately (avoiding bloated BullMQ job payload)
        const payload: ImportJobItemsPayload = { items, lists };
        await redis.set(`import:items:${jobId}`, JSON.stringify(payload), "EX", JOB_ITEMS_TTL);

        // 3. Enqueue lightweight BullMQ job
        await importQueue.add(
            "import-letterboxd",
            { jobId, userId, totalItems },
            {
                jobId,
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 100 },
            },
        );

        return {
            jobId,
            status: "queued",
            totalItems,
            type: "letterboxd",
        };
    },

    /**
     * Creates a Spotify playlist import job, validates playlist links/IDs,
     * stores progress in Redis, and enqueues a BullMQ job.
     */
    createSpotifyImportJob: async (userId: string, rawUrls: string[]): Promise<ImportResponseDto> => {
        if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
            throw new ApiError("AT_LEAST_ONE_PLAYLIST_REQUIRED", 400, "At least one Spotify playlist URL or ID is required.");
        }

        // Parse and validate all playlist IDs
        const playlistIds: string[] = [];
        for (const input of rawUrls) {
            const parsedId = parseSpotifyPlaylistId(input);
            if (parsedId && !playlistIds.includes(parsedId)) {
                playlistIds.push(parsedId);
            }
        }

        if (playlistIds.length === 0) {
            throw new ApiError("INVALID_SPOTIFY_PLAYLIST_URL", 400, "No valid Spotify playlist IDs found.");
        }

        const jobId = nanoid();
        const now = new Date().toISOString();
        const totalItems = playlistIds.length;

        const progress: ImportJobProgress = {
            jobId,
            userId,
            status: "queued",
            type: "spotify",
            totalItems,
            processedItems: 0,
            successCount: 0,
            failedCount: 0,
            playlistsCount: 0,
            tracksCount: 0,
            createdAt: now,
            updatedAt: now,
        };

        // 1. Save progress state in Redis
        await redis.set(`import:job:${jobId}`, JSON.stringify(progress), "EX", JOB_PROGRESS_TTL);

        // 2. Save payload in Redis
        const payload: SpotifyImportJobItemsPayload = { playlistIds };
        await redis.set(`import:items:${jobId}`, JSON.stringify(payload), "EX", JOB_ITEMS_TTL);

        // 3. Enqueue lightweight BullMQ job
        await importQueue.add(
            "import-spotify",
            { jobId, userId, totalItems, type: "spotify" },
            {
                jobId,
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 100 },
            },
        );

        return {
            jobId,
            status: "queued",
            totalItems,
            type: "spotify",
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
