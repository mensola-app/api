export interface LetterboxdDiaryRow {
    Date?: string;
    Name: string;
    Year?: string;
    "Letterboxd URI"?: string;
    Rating?: string;
    Rewatch?: string;
    Tags?: string;
    "Watched Date"?: string;
}

export interface LetterboxdWatchedRow {
    Date?: string;
    Name: string;
    Year?: string;
    "Letterboxd URI"?: string;
}

export interface LetterboxdRatingRow {
    Date?: string;
    Name: string;
    Year?: string;
    "Letterboxd URI"?: string;
    Rating?: string;
}

export interface LetterboxdReviewRow {
    Date?: string;
    Name: string;
    Year?: string;
    "Letterboxd URI"?: string;
    Rating?: string;
    Rewatch?: string;
    Review?: string;
    Tags?: string;
    "Watched Date"?: string;
}

export interface LetterboxdLikeRow {
    Date?: string;
    Name: string;
    Year?: string;
    "Letterboxd URI"?: string;
}

export interface LetterboxdWatchlistRow {
    Date?: string;
    Name: string;
    Year?: string;
    "Letterboxd URI"?: string;
}

export interface ImportMovieItem {
    name: string;
    year: number | null;
    letterboxdUri?: string;
    rating?: number | null; // Mensola scale 0.0 - 10.0 (Letterboxd * 2)
    review?: string | null; // Sanitized text
    isLiked?: boolean;
    watchedDates: string[]; // List of distinct watch timestamps/dates
    rewatch?: boolean;
    isWatched: boolean;
    inWatchlist?: boolean;
    watchlistDate?: string | null;
}

export type ImportJobStatus = "queued" | "processing" | "completed" | "failed";

export interface ImportJobPayload {
    jobId: string;
    userId: string;
    totalItems: number;
}

export interface ImportFailedItem {
    movie: string;
    year?: number | null;
    error: string;
}

export interface ImportJobProgress {
    jobId: string;
    userId: string;
    status: ImportJobStatus;
    totalItems: number;
    processedItems: number;
    successCount: number;
    failedCount: number;
    watchedCount?: number;
    watchlistCount?: number;
    errors?: ImportFailedItem[];
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
}

export interface ImportResponseDto {
    jobId: string;
    status: ImportJobStatus;
    totalItems: number;
}
