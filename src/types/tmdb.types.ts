import { TmdbId } from "./common.types";

export interface ITmdbCastMember {
    id: number;
    name: string;
    profile_path: string | null;
    character: string;
    order: number;
}

export interface ITmdbCrewMember {
    id: number;
    name: string;
    profile_path: string | null;
    department: string;
    job: string;
}

export interface ITmdbMovie {
    id: TmdbId;
    original_title: string;
    title?: string;
    overview: string;
    poster_path: string | null;
    backdrop_path?: string | null;
    release_date: string;
    vote_average: number;
    vote_count: number;
    popularity?: number;
    genre_ids: number[];
    genres?: { id: number; name: string }[];
    runtime?: number;
    credits?: {
        cast: ITmdbCastMember[];
        crew: ITmdbCrewMember[];
    };
}

export type SearchMovieResult = {
    page: number;
    results: ITmdbMovie[];
    total_pages: number;
    total_results: number;
};
export type TrendMoviesResult = {
    page: number;
    results: ITmdbMovie[];
    total_pages: number;
    total_results: number;
};
