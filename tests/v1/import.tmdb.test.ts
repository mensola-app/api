import { tmdbService } from "@/services/tmdb.service";

describe("TMDB Service searchMovieWithTolerance", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("should return the exact year match if available", async () => {
        const mockMovie = {
            id: 12345,
            original_title: "Coyote vs. Acme",
            release_date: "2026-07-21",
            poster_path: "/poster.jpg",
            vote_average: 8.5,
            genre_ids: [16, 35],
        };

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [mockMovie],
                total_results: 1,
                page: 1,
                total_pages: 1,
            }),
        });

        const result = await tmdbService.searchMovieWithTolerance("Coyote vs. Acme", 2026);

        expect(result).toBeDefined();
        expect(result?.id).toBe(12345);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should fallback to search without year and accept +/- 1 year tolerance", async () => {
        const mockMovieWithShift = {
            id: 99999,
            original_title: "Festival Film",
            release_date: "2020-01-15", // 1 year after 2019
            poster_path: "/festival.jpg",
            vote_average: 7.2,
            genre_ids: [18],
        };

        // First call with year returns empty results
        // Second call without year returns the film with 2020 release
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ results: [], total_results: 0, page: 1, total_pages: 1 }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ results: [mockMovieWithShift], total_results: 1, page: 1, total_pages: 1 }),
            });

        const result = await tmdbService.searchMovieWithTolerance("Festival Film", 2019);

        expect(result).toBeDefined();
        expect(result?.id).toBe(99999);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should return null if fallback search results are outside +/- 1 year tolerance", async () => {
        const mockOldFilm = {
            id: 88888,
            original_title: "Old Film",
            release_date: "1995-01-15", // 20 years before 2015
            poster_path: "/old.jpg",
            vote_average: 6.0,
            genre_ids: [18],
        };

        global.fetch = jest
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ results: [], total_results: 0, page: 1, total_pages: 1 }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ results: [mockOldFilm], total_results: 1, page: 1, total_pages: 1 }),
            });

        const result = await tmdbService.searchMovieWithTolerance("Old Film", 2015);

        expect(result).toBeNull();
    });
});
