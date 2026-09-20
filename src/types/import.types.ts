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

export interface LetterboxdListMetaRow {
    Date?: string;
    Name?: string;
    Tags?: string;
    URL?: string;
    Description?: string;
}

export interface LetterboxdListItemRow {
    Position?: string;
    Name: string;
    Year?: string;
    URL?: string;
    Description?: string;
}

export interface ImportListItemMovie {
    name: string;
    year: number | null;
    position?: number;
    description?: string | null;
    url?: string;
}

export interface ImportCustomList {
    title: string;
    description: string | null;
    createdAt?: string | null;
    letterboxdUri?: string | null;
    isPrivate: boolean; // Always false (public) as requested
    movies: ImportListItemMovie[];
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

export interface ImportJobItemsPayload {
    items: ImportMovieItem[];
    lists: ImportCustomList[];
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
    listsCount?: number;
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

