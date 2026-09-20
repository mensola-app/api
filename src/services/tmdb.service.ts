import { mapGenreIdsToNames } from "@/constants/tmdb";
import { TmdbId } from "@/types/common.types";
import { IMovie, IMovieCredits } from "@/types/movie.types";
import { ITmdbMovie, SearchMovieResult, TrendMoviesResult } from "@/types/tmdb.types";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN;

export const getTmdbImage = (path: string | null, size: "w342" | "w500" | "w780" | "original" = "w500") => {
    if (!path) return "";
    return `https://image.tmdb.org/t/p/${size}${path}`;
};

export const tmdbService = {
    searchMovie: async (query: string, page: number = 1) => {
        const res = await fetch(
            `${TMDB_BASE_URL}/search/movie?query=${encodeURIComponent(query)}&page=${page}&language=en-US`,
            { headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" } },
        );

        const searchData = (await res.json()) as SearchMovieResult;

        const movies: Omit<IMovie, "id">[] = searchData.results.map((item: ITmdbMovie) => {
            const movie: Omit<IMovie, "id"> = {
                tmdbId: item.id,
                title: item.original_title,
                poster: getTmdbImage(item.poster_path),
                releaseDate: item.release_date,
                rating: item.vote_average,
                genres: mapGenreIdsToNames(item.genre_ids),
            };

            return movie;
        });

        const hasMore = searchData.page < searchData.total_pages;
        const totalResults = searchData.total_results;

        return { items: movies, page, hasMore, totalResults };
    },

    getTrendMovies: async (page: number) => {
        const res = await fetch(`${TMDB_BASE_URL}/trending/movie/day?language=en-US&page=${page}`, {
            headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
        });

        const trendMovieData = (await res.json()) as TrendMoviesResult;

        const movies: Omit<IMovie, "id">[] = trendMovieData.results.map((item: ITmdbMovie) => {
            const movie: Omit<IMovie, "id"> = {
                tmdbId: item.id,
                title: item.original_title,
                poster: getTmdbImage(item.poster_path),
                releaseDate: item.release_date,
                rating: item.vote_average,
                genres: mapGenreIdsToNames(item.genre_ids),
            };

            return movie;
        });

        const hasMore = trendMovieData.page < trendMovieData.total_pages;
        const totalResults = trendMovieData.total_results;

        return { items: movies, page, hasMore, totalResults };
    },

    getMovieByTmdbId: async (tmdbId: TmdbId) => {
        const res = await fetch(`${TMDB_BASE_URL}/movie/${tmdbId}?language=en-US&append_to_response=credits`, {
            headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
        });

        const movieData = (await res.json()) as ITmdbMovie;

        // Parse credits
        let credits: IMovieCredits | undefined;

        if (movieData.credits) {
            const { cast, crew } = movieData.credits;

            const topCast = [...cast]
                .sort((a, b) => a.order - b.order)
                .slice(0, 10)
                .map((c) => ({
                    id: c.id,
                    name: c.name,
                    profilePath: getTmdbImage(c.profile_path),
                    character: c.character,
                }));

            const WRITER_JOBS = ["Screenplay", "Screenstory", "Writer"];

            const directors = crew
                .filter((c) => c.job === "Director")
                .map((c) => ({ id: c.id, name: c.name, profilePath: getTmdbImage(c.profile_path) }));

            // Deduplicate writers by id (same person can have multiple writing credits)
            const writersMap = new Map<number, { id: number; name: string; profilePath: string }>();
            crew.filter((c) => WRITER_JOBS.includes(c.job)).forEach((c) => {
                if (!writersMap.has(c.id)) {
                    writersMap.set(c.id, { id: c.id, name: c.name, profilePath: getTmdbImage(c.profile_path) });
                }
            });
            const writers = Array.from(writersMap.values());

            const cinematographers = crew
                .filter((c) => c.job === "Director of Photography")
                .map((c) => ({ id: c.id, name: c.name, profilePath: getTmdbImage(c.profile_path) }));

            credits = {
                cast: topCast,
                crew: { directors, writers, cinematographers },
            };
        }

        const movie: Omit<IMovie, "id"> = {
            tmdbId: movieData.id,
            title: movieData.original_title,
            poster: getTmdbImage(movieData.poster_path),
            releaseDate: movieData.release_date,
            rating: movieData.vote_average,
            genres: movieData.genres ? movieData.genres.map((g) => g.name) : [],
            duration: movieData.runtime || undefined,
            overview: movieData.overview || undefined,
            credits,
        };

        return movie;
    },

    /**
     * Returns the top `limit` trending movies of the day enriched with
     * backdrop and overview — used by the /v1/home hero section.
     */
    getTrendingHero: async (limit: number = 5) => {
        const res = await fetch(`${TMDB_BASE_URL}/trending/movie/day?language=en-US&page=1`, {
            headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
        });

        if (!res.ok) throw new Error(`TMDB trending failed: ${res.status}`);

        const data = (await res.json()) as TrendMoviesResult;

        return data.results.slice(0, limit).map((item: ITmdbMovie) => ({
            tmdbId: item.id as TmdbId,
            title: item.original_title,
            overview: item.overview,
            backdropUrl: getTmdbImage(item.backdrop_path ?? null, "original"),
            posterUrl: getTmdbImage(item.poster_path ?? null, "w342"),
            rating: item.vote_average,
        }));
    },

    /**
     * Returns current theatrical releases — used by the /v1/home now-playing section.
     */
    getNowPlaying: async (limit: number = 15) => {
        const res = await fetch(`${TMDB_BASE_URL}/movie/now_playing?language=en-US&page=1`, {
            headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
        });

        if (!res.ok) throw new Error(`TMDB now_playing failed: ${res.status}`);

        const data = (await res.json()) as TrendMoviesResult;

        return data.results.slice(0, limit).map((item: ITmdbMovie) => ({
            tmdbId: item.id as TmdbId,
            title: item.original_title,
            posterUrl: getTmdbImage(item.poster_path ?? null, "w342"),
            rating: item.vote_average,
            releaseDate: item.release_date,
        }));
    },

    /**
     * Searches TMDB for a movie by title and year with a +/- 1 year fallback tolerance,
     * scoring candidates to pick the best title and year match.
     */
    searchMovieWithTolerance: async (query: string, year?: number | null): Promise<ITmdbMovie | null> => {
        const normalize = (str?: string | null): string => {
            if (!str) return "";
            return str
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]/g, "")
                .trim();
        };

        const scoreCandidate = (m: ITmdbMovie, q: string, targetYear?: number | null): number => {
            const normQuery = normalize(q);
            const normTitle = normalize(m.title);
            const normOrig = normalize(m.original_title);

            const isExactTitle = (normTitle && normTitle === normQuery) || (normOrig && normOrig === normQuery);
            const isPartialTitle =
                (normTitle && (normTitle.includes(normQuery) || normQuery.includes(normTitle))) ||
                (normOrig && (normOrig.includes(normQuery) || normQuery.includes(normOrig)));

            const mYear = m.release_date ? parseInt(m.release_date.split("-")[0], 10) : null;
            const isExactYear = Boolean(targetYear && mYear === targetYear);
            const isTolYear = Boolean(targetYear && mYear && Math.abs(mYear - targetYear) <= 1);

            if (targetYear) {
                // Must be within +/- 1 year tolerance when year is specified
                if (!isTolYear) return 0;

                if (isExactTitle && isExactYear) return 100;
                if (isExactTitle && isTolYear) return 80;
                if (isPartialTitle && isExactYear) return 60;
                if (isPartialTitle && isTolYear) return 40;
                return 10;
            } else {
                if (isExactTitle) return 100;
                if (isPartialTitle) return 50;
                return 10;
            }
        };

        const findBestCandidate = (
            candidates: ITmdbMovie[],
            q: string,
            targetYear?: number | null,
        ): ITmdbMovie | null => {
            if (!candidates || candidates.length === 0) return null;

            const scored = candidates
                .map((m) => ({
                    movie: m,
                    score: scoreCandidate(m, q, targetYear),
                }))
                .filter((item) => item.score > 0)
                .sort(
                    (a, b) =>
                        b.score - a.score ||
                        (b.movie.vote_count ?? 0) - (a.movie.vote_count ?? 0) ||
                        (b.movie.popularity ?? 0) - (a.movie.popularity ?? 0),
                );

            return scored.length > 0 ? scored[0].movie : null;
        };

        // 1. Search with year if provided
        if (year) {
            const resWithYear = await fetch(
                `${TMDB_BASE_URL}/search/movie?query=${encodeURIComponent(query)}&year=${year}&language=en-US`,
                { headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" } },
            );
            if (resWithYear.ok) {
                const data = (await resWithYear.json()) as SearchMovieResult;
                const best = findBestCandidate(data.results, query, year);
                if (best) return best;
            }
        }

        // 2. Search without year filter as fallback
        const resWithoutYear = await fetch(
            `${TMDB_BASE_URL}/search/movie?query=${encodeURIComponent(query)}&language=en-US`,
            { headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" } },
        );
        if (!resWithoutYear.ok) return null;

        const data = (await resWithoutYear.json()) as SearchMovieResult;
        return findBestCandidate(data.results, query, year);
    },
};

