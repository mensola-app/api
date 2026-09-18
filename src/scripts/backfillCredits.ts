import pool from "@/config/db";
import { getTmdbImage } from "@/services/tmdb.service";
import { ITmdbCastMember, ITmdbCrewMember } from "@/types/tmdb.types";
import { IMovieCredits } from "@/types/movie.types";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN;

const WRITER_JOBS = ["Screenplay", "Screenstory", "Writer"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function backfillCredits() {
    console.log("[BACKFILL] Starting credits backfill for existing movies...");

    // Get all movies that don't have credits yet
    const { rows: movies } = await pool.query<{ id: string; tmdbId: number }>(
        `SELECT id, "tmdbId" FROM "Movie" WHERE credits IS NULL AND "tmdbId" IS NOT NULL`
    );

    console.log(`[BACKFILL] Found ${movies.length} movies without credits.`);

    if (movies.length === 0) {
        console.log("[BACKFILL] Nothing to do. Exiting.");
        await pool.end();
        return;
    }

    let success = 0;
    let failed = 0;

    for (const movie of movies) {
        try {
            // Fetch movie with credits from TMDB
            const res = await fetch(
                `${TMDB_BASE_URL}/movie/${movie.tmdbId}?language=en-US&append_to_response=credits`,
                { headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" } }
            );

            if (!res.ok) {
                console.error(`[BACKFILL] TMDB API error for tmdbId=${movie.tmdbId}: ${res.status}`);
                failed++;
                continue;
            }

            const data = await res.json();

            if (!data.credits) {
                console.warn(`[BACKFILL] No credits in TMDB response for tmdbId=${movie.tmdbId}`);
                failed++;
                continue;
            }

            const { cast, crew }: { cast: ITmdbCastMember[]; crew: ITmdbCrewMember[] } = data.credits;

            // Top 10 cast by order
            const topCast = [...cast]
                .sort((a, b) => a.order - b.order)
                .slice(0, 10)
                .map((c) => ({
                    id: c.id,
                    name: c.name,
                    profilePath: getTmdbImage(c.profile_path),
                    character: c.character,
                }));

            // Directors
            const directors = crew
                .filter((c) => c.job === "Director")
                .map((c) => ({ id: c.id, name: c.name, profilePath: getTmdbImage(c.profile_path) }));

            // Writers (deduplicated)
            const writersMap = new Map<number, { id: number; name: string; profilePath: string }>();
            crew.filter((c) => WRITER_JOBS.includes(c.job)).forEach((c) => {
                if (!writersMap.has(c.id)) {
                    writersMap.set(c.id, { id: c.id, name: c.name, profilePath: getTmdbImage(c.profile_path) });
                }
            });
            const writers = Array.from(writersMap.values());

            // Cinematographers
            const cinematographers = crew
                .filter((c) => c.job === "Director of Photography")
                .map((c) => ({ id: c.id, name: c.name, profilePath: getTmdbImage(c.profile_path) }));

            const credits: IMovieCredits = {
                cast: topCast,
                crew: { directors, writers, cinematographers },
            };

            // Update the movie in DB
            await pool.query(
                `UPDATE "Movie" SET credits = $1 WHERE id = $2`,
                [JSON.stringify(credits), movie.id]
            );

            success++;
            console.log(`[BACKFILL] ✅ Updated movie id=${movie.id} (tmdbId=${movie.tmdbId})`);

            // Rate limit: TMDB allows ~40 req/10s, so ~250ms delay is safe
            await sleep(300);
        } catch (err) {
            console.error(`[BACKFILL] ❌ Failed for movie id=${movie.id} (tmdbId=${movie.tmdbId}):`, err);
            failed++;
        }
    }

    console.log(`\n[BACKFILL] Done! ✅ ${success} updated, ❌ ${failed} failed out of ${movies.length} total.`);
    await pool.end();
}

backfillCredits().catch((err) => {
    console.error("[BACKFILL] Fatal error:", err);
    process.exit(1);
});
