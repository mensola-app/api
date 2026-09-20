import request from "supertest";
import AdmZip from "adm-zip";
import app from "@/app";
import { generateTestToken } from "../helpers/auth.helper";
import { importService, sanitizeHtml } from "@/services/import.service";

// In-memory Redis store for tests
const redisStore = new Map<string, string>();

jest.mock("@/config/redis", () => ({
    redis: {
        get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
        set: jest.fn(async (key: string, value: string) => {
            redisStore.set(key, value);
            return "OK";
        }),
        del: jest.fn(async (...keys: string[]) => {
            keys.forEach((k) => redisStore.delete(k));
            return keys.length;
        }),
    },
}));

jest.mock("@/jobs/import.queue", () => ({
    importQueue: {
        add: jest.fn(async (name: string, data: any, opts: any) => ({
            id: opts?.jobId || "mock-job-id",
            name,
            data,
        })),
    },
    bullmqRedisConnection: {},
}));

describe("Letterboxd Import Pipeline", () => {
    beforeEach(() => {
        redisStore.clear();
    });

    describe("sanitizeHtml", () => {
        it("should strip HTML tags and decode HTML entities", () => {
            const raw = "<p>This is a <b>great</b> movie! &amp; I loved it.</p><br><p>&quot;Classic&quot;&#39;s masterpiece.</p>";
            const sanitized = sanitizeHtml(raw);

            expect(sanitized).not.toContain("<p>");
            expect(sanitized).not.toContain("<b>");
            expect(sanitized).not.toContain("</p>");
            expect(sanitized).not.toContain("<br>");
            expect(sanitized).toContain("&");
            expect(sanitized).toContain('"Classic"');
            expect(sanitized).toContain("'s masterpiece");
        });

        it("should return empty string for null or undefined", () => {
            expect(sanitizeHtml(null)).toBe("");
            expect(sanitizeHtml(undefined)).toBe("");
            expect(sanitizeHtml("")).toBe("");
        });
    });

    describe("validateAndParseZip", () => {
        it("should throw error if zip has none of watched, ratings, diary, or watchlist csv", () => {
            const zip = new AdmZip();
            zip.addFile("dummy.txt", Buffer.from("hello world"));
            const buffer = zip.toBuffer();

            expect(() => importService.validateAndParseZip(buffer)).toThrow();
        });

        it("should successfully parse standalone watchlist.csv", () => {
            const zip = new AdmZip();
            const watchlistCsv = [
                "Date,Name,Year,Letterboxd URI",
                "2026-05-31,Capital,2012,https://boxd.it/43qS",
                "2026-06-02,Fracture,2007,https://boxd.it/220K",
            ].join("\n");
            zip.addFile("watchlist.csv", Buffer.from(watchlistCsv));

            const buffer = zip.toBuffer();
            const { items, totalItems } = importService.validateAndParseZip(buffer);

            expect(totalItems).toBe(2);
            expect(items.length).toBe(2);

            const capital = items.find((i) => i.name === "Capital");
            expect(capital).toBeDefined();
            expect(capital?.year).toBe(2012);
            expect(capital?.inWatchlist).toBe(true);
            expect(capital?.watchlistDate).toBe("2026-05-31");
            expect(capital?.isWatched).toBe(false);

            const fracture = items.find((i) => i.name === "Fracture");
            expect(fracture).toBeDefined();
            expect(fracture?.year).toBe(2007);
            expect(fracture?.inWatchlist).toBe(true);
            expect(fracture?.watchlistDate).toBe("2026-06-02");
            expect(fracture?.isWatched).toBe(false);
        });

        it("should correctly handle both watched.csv and watchlist.csv", () => {
            const zip = new AdmZip();
            const watchedCsv = [
                "Date,Name,Year,Letterboxd URI",
                "2026-01-10,Inception,2010,https://boxd.it/1770",
            ].join("\n");
            const watchlistCsv = [
                "Date,Name,Year,Letterboxd URI",
                "2026-05-31,Capital,2012,https://boxd.it/43qS",
                "2026-06-01,Inception,2010,https://boxd.it/1770",
            ].join("\n");
            zip.addFile("watched.csv", Buffer.from(watchedCsv));
            zip.addFile("watchlist.csv", Buffer.from(watchlistCsv));

            const buffer = zip.toBuffer();
            const { items, totalItems } = importService.validateAndParseZip(buffer);

            expect(totalItems).toBe(2);
            const inception = items.find((i) => i.name === "Inception");
            expect(inception).toBeDefined();
            expect(inception?.isWatched).toBe(true);
            expect(inception?.inWatchlist).toBe(true);
            expect(inception?.watchlistDate).toBe("2026-06-01");

            const capital = items.find((i) => i.name === "Capital");
            expect(capital).toBeDefined();
            expect(capital?.isWatched).toBe(false);
            expect(capital?.inWatchlist).toBe(true);
        });

        it("should ignore __MACOSX and hidden files", () => {
            const zip = new AdmZip();
            zip.addFile("__MACOSX/._ratings.csv", Buffer.from("garbage"));
            const buffer = zip.toBuffer();

            expect(() => importService.validateAndParseZip(buffer)).toThrow();
        });

        it("should successfully parse and merge watched, ratings, reviews, and likes with de-duplication", () => {
            const zip = new AdmZip();

            // reviews.csv
            const reviewsCsv = [
                "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date",
                '2026-09-21,Coyote vs. Acme,2026,https://boxd.it/JHdm,4.5,Yes,"<p>Amazing film!</p>",,2026-09-01',
                '2026-09-22,Coyote vs. Acme,2026,https://boxd.it/JHdm,5.0,Yes,"Rewatched it!",,2026-09-15',
            ].join("\n");
            zip.addFile("reviews.csv", Buffer.from(reviewsCsv));

            // likes/films.csv
            const likesCsv = [
                "Date,Name,Year,Letterboxd URI",
                "2026-09-21,Coyote vs. Acme,2026,https://boxd.it/JHdm",
                "2026-09-21,Resident Evil,2026,https://boxd.it/SEXE",
            ].join("\n");
            zip.addFile("likes/films.csv", Buffer.from(likesCsv));

            // ratings.csv
            const ratingsCsv = [
                "Date,Name,Year,Letterboxd URI,Rating",
                "2026-09-21,Resident Evil,2026,https://boxd.it/SEXE,3.5",
                "2026-09-21,Inception,2010,https://boxd.it/1770,4.0",
            ].join("\n");
            zip.addFile("ratings.csv", Buffer.from(ratingsCsv));

            // watched.csv
            const watchedCsv = [
                "Date,Name,Year,Letterboxd URI",
                "2026-09-21,The Matrix,1999,https://boxd.it/2aCW",
            ].join("\n");
            zip.addFile("watched.csv", Buffer.from(watchedCsv));

            const buffer = zip.toBuffer();
            const { items, totalItems } = importService.validateAndParseZip(buffer);

            // Should have 4 unique movies: Coyote vs. Acme, Resident Evil, Inception, The Matrix
            expect(totalItems).toBe(4);
            expect(items.length).toBe(4);

            // 1. Coyote vs. Acme: rating 9.0 (4.5 * 2), isLiked true, review "Amazing film!", 2 watch dates
            const coyote = items.find((i) => i.name === "Coyote vs. Acme");
            expect(coyote).toBeDefined();
            expect(coyote?.year).toBe(2026);
            expect(coyote?.rating).toBe(9); // 4.5 * 2
            expect(coyote?.isLiked).toBe(true);
            expect(coyote?.review).toBe("Amazing film!");
            expect(coyote?.rewatch).toBe(true);
            expect(coyote?.watchedDates).toContain("2026-09-01");
            expect(coyote?.watchedDates).toContain("2026-09-15");

            // 2. Resident Evil: rating 7.0 (3.5 * 2), isLiked true
            const residentEvil = items.find((i) => i.name === "Resident Evil");
            expect(residentEvil).toBeDefined();
            expect(residentEvil?.rating).toBe(7);
            expect(residentEvil?.isLiked).toBe(true);
            expect(residentEvil?.isWatched).toBe(true);

            // 3. Inception: rating 8.0 (4.0 * 2)
            const inception = items.find((i) => i.name === "Inception");
            expect(inception).toBeDefined();
            expect(inception?.rating).toBe(8);
            expect(inception?.isWatched).toBe(true);

            // 4. The Matrix: isWatched true, no rating
            const matrix = items.find((i) => i.name === "The Matrix");
            expect(matrix).toBeDefined();
            expect(matrix?.isWatched).toBe(true);
            expect(matrix?.rating).toBeNull();
        });

        it("should prioritize diary.csv Watched Date and ignore other CSV dates for the same movie", () => {
            const zip = new AdmZip();

            // diary.csv with 2 watches (one initial, one rewatch)
            const diaryCsv = [
                "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date",
                "2023-05-13,Interstellar,2014,https://boxd.it/6GsW,4.5,No,,2023-05-12",
                "2024-01-11,Interstellar,2014,https://boxd.it/6GsW,5.0,Yes,,2024-01-10",
            ].join("\n");
            zip.addFile("diary.csv", Buffer.from(diaryCsv));

            // reviews.csv with different date
            const reviewsCsv = [
                "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date",
                '2023-05-15,Interstellar,2014,https://boxd.it/6GsW,4.5,No,"Masterpiece",,2023-05-15',
            ].join("\n");
            zip.addFile("reviews.csv", Buffer.from(reviewsCsv));

            // ratings.csv with different date
            const ratingsCsv = [
                "Date,Name,Year,Letterboxd URI,Rating",
                "2023-05-16,Interstellar,2014,https://boxd.it/6GsW,4.5",
            ].join("\n");
            zip.addFile("ratings.csv", Buffer.from(ratingsCsv));

            // watched.csv with different date
            const watchedCsv = [
                "Date,Name,Year,Letterboxd URI",
                "2023-05-10,Interstellar,2014,https://boxd.it/6GsW",
            ].join("\n");
            zip.addFile("watched.csv", Buffer.from(watchedCsv));

            const buffer = zip.toBuffer();
            const { items } = importService.validateAndParseZip(buffer);

            const interstellar = items.find((i) => i.name === "Interstellar");
            expect(interstellar).toBeDefined();
            // Watched dates must come exclusively from diary.csv Watched Date values
            expect(interstellar?.watchedDates).toEqual(["2023-05-12", "2024-01-10"]);
            expect(interstellar?.rating).toBe(9); // 4.5 * 2
            expect(interstellar?.review).toBe("Masterpiece");
            expect(interstellar?.rewatch).toBe(true);
        });

        it("should not create duplicate watch dates for non-diary movies across watched.csv and ratings.csv", () => {
            const zip = new AdmZip();

            // Movie in both watched.csv and ratings.csv with different dates
            const watchedCsv = [
                "Date,Name,Year,Letterboxd URI",
                "2022-01-01,Fight Club,1999,https://boxd.it/209K",
            ].join("\n");
            zip.addFile("watched.csv", Buffer.from(watchedCsv));

            const ratingsCsv = [
                "Date,Name,Year,Letterboxd URI,Rating",
                "2022-06-15,Fight Club,1999,https://boxd.it/209K,4.5",
            ].join("\n");
            zip.addFile("ratings.csv", Buffer.from(ratingsCsv));

            const buffer = zip.toBuffer();
            const { items } = importService.validateAndParseZip(buffer);

            const fightClub = items.find((i) => i.name === "Fight Club");
            expect(fightClub).toBeDefined();
            // Must have only 1 watch date (from watched.csv), not 2
            expect(fightClub?.watchedDates).toEqual(["2022-01-01"]);
            expect(fightClub?.rating).toBe(9);
            expect(fightClub?.isWatched).toBe(true);
        });

        it("should correctly de-duplicate when diary.csv has entry URI and watched.csv has film URI", () => {
            const zip = new AdmZip();

            // diary.csv has a diary entry URI (specific to the log)
            const diaryCsv = [
                "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date",
                "2023-05-13,Oppenheimer,2023,https://boxd.it/3Y7x,4.5,No,,2023-05-12",
            ].join("\n");
            zip.addFile("diary.csv", Buffer.from(diaryCsv));

            // watched.csv has the film URI
            const watchedCsv = [
                "Date,Name,Year,Letterboxd URI",
                "2023-05-10,Oppenheimer,2023,https://boxd.it/6GsW",
            ].join("\n");
            zip.addFile("watched.csv", Buffer.from(watchedCsv));

            // ratings.csv has the film URI
            const ratingsCsv = [
                "Date,Name,Year,Letterboxd URI,Rating",
                "2023-05-14,Oppenheimer,2023,https://boxd.it/6GsW,4.5",
            ].join("\n");
            zip.addFile("ratings.csv", Buffer.from(ratingsCsv));

            const buffer = zip.toBuffer();
            const { items, totalItems } = importService.validateAndParseZip(buffer);

            // Exactly 1 movie item must exist (not 2 or 3)
            expect(totalItems).toBe(1);
            expect(items.length).toBe(1);

            const oppenheimer = items[0];
            expect(oppenheimer.name).toBe("Oppenheimer");
            expect(oppenheimer.year).toBe(2023);
            // Must have only 1 watch date (from diary.csv), not multiple
            expect(oppenheimer.watchedDates).toEqual(["2023-05-12"]);
            expect(oppenheimer.rating).toBe(9);
            expect(oppenheimer.isWatched).toBe(true);
        });
    });

    describe("POST /v1/imports/letterboxd", () => {
        const testUserId = "00000000-0000-0000-0000-000000000001";
        const testToken = generateTestToken(testUserId);

        it("should return 401 if user is not authenticated", async () => {
            const res = await request(app)
                .post("/v1/imports/letterboxd")
                .attach("file", Buffer.from("not-a-zip"), "test.zip");

            expect(res.status).toBe(401);
        });

        it("should return 400 if no file is uploaded", async () => {
            const res = await request(app)
                .post("/v1/imports/letterboxd")
                .set("Authorization", `Bearer ${testToken}`);

            expect(res.status).toBe(400);
        });

        it("should return 400 if uploaded file is not a valid zip", async () => {
            const res = await request(app)
                .post("/v1/imports/letterboxd")
                .set("Authorization", `Bearer ${testToken}`)
                .attach("file", Buffer.from("invalid-zip-content"), "test.zip");

            expect(res.status).toBe(400);
        });

        it("should return 202 with jobId, status: queued, and totalItems for valid zip", async () => {
            const zip = new AdmZip();
            const watchedCsv = [
                "Date,Name,Year,Letterboxd URI",
                "2026-09-21,Coyote vs. Acme,2026,https://boxd.it/JHdm",
            ].join("\n");
            zip.addFile("watched.csv", Buffer.from(watchedCsv));

            const res = await request(app)
                .post("/v1/imports/letterboxd")
                .set("Authorization", `Bearer ${testToken}`)
                .attach("file", zip.toBuffer(), "export.zip");

            expect(res.status).toBe(202);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            expect(res.body.data.status).toBe("queued");
            expect(res.body.data.totalItems).toBe(1);
            expect(res.body.data.jobId).toBeDefined();

            // Verify progress endpoint
            const jobId = res.body.data.jobId;
            const progressRes = await request(app)
                .get(`/v1/imports/${jobId}`)
                .set("Authorization", `Bearer ${testToken}`);

            expect(progressRes.status).toBe(200);
            expect(progressRes.body.success).toBe(true);
            expect(progressRes.body.data.jobId).toBe(jobId);
            expect(progressRes.body.data.status).toBe("queued");
            expect(progressRes.body.data.totalItems).toBe(1);
        });

        it("should return 202 for zip containing only watchlist.csv", async () => {
            const zip = new AdmZip();
            const watchlistCsv = [
                "Date,Name,Year,Letterboxd URI",
                "2026-05-31,Capital,2012,https://boxd.it/43qS",
            ].join("\n");
            zip.addFile("watchlist.csv", Buffer.from(watchlistCsv));

            const res = await request(app)
                .post("/v1/imports/letterboxd")
                .set("Authorization", `Bearer ${testToken}`)
                .attach("file", zip.toBuffer(), "export.zip");

            expect(res.status).toBe(202);
            expect(res.body.success).toBe(true);
            expect(res.body.data.totalItems).toBe(1);
            expect(res.body.data.status).toBe("queued");
        });

        it("should return 202 for zip containing only custom lists under lists/ directory", async () => {
            const zip = new AdmZip();
            const listCsv = [
                "Letterboxd list export v7",
                "Date,Name,Tags,URL,Description",
                "2026-07-16,watch again,,https://boxd.it/VIEfM,My favorite rewatches",
                "",
                "Position,Name,Year,URL,Description",
                "1,Sherlock Holmes,2009,https://boxd.it/1W2A,",
                "2,Sherlock Holmes: A Game of Shadows,2011,https://boxd.it/k3S,",
            ].join("\n");
            zip.addFile("lists/watch-again.csv", Buffer.from(listCsv));

            const res = await request(app)
                .post("/v1/imports/letterboxd")
                .set("Authorization", `Bearer ${testToken}`)
                .attach("file", zip.toBuffer(), "export.zip");

            expect(res.status).toBe(202);
            expect(res.body.success).toBe(true);
            expect(res.body.data.totalItems).toBe(1); // 1 list item
            expect(res.body.data.status).toBe("queued");
        });
    });

    describe("Custom Lists Parsing", () => {
        it("should parse custom list with metadata and movie items preserving positions", () => {
            const zip = new AdmZip();
            const listCsv = [
                "Letterboxd list export v7",
                "Date,Name,Tags,URL,Description",
                "2026-07-16,watch again,,https://boxd.it/VIEfM,Re-watching detective films",
                "",
                "Position,Name,Year,URL,Description",
                "1,Sherlock Holmes,2009,https://boxd.it/1W2A,",
                "2,Sherlock Holmes: A Game of Shadows,2011,https://boxd.it/k3S,",
                "3,Sherlock: The Abominable Bride,2016,https://boxd.it/dbTQ,",
            ].join("\n");
            zip.addFile("lists/watch-again.csv", Buffer.from(listCsv));

            const buffer = zip.toBuffer();
            const { lists, totalItems } = importService.validateAndParseZip(buffer);

            expect(totalItems).toBe(1);
            expect(lists.length).toBe(1);

            const list = lists[0];
            expect(list.title).toBe("watch again");
            expect(list.description).toBe("Re-watching detective films");
            expect(list.isPrivate).toBe(false); // always public
            expect(list.createdAt).toBe("2026-07-16");
            expect(list.letterboxdUri).toBe("https://boxd.it/VIEfM");

            expect(list.movies.length).toBe(3);
            expect(list.movies[0].name).toBe("Sherlock Holmes");
            expect(list.movies[0].year).toBe(2009);
            expect(list.movies[0].position).toBe(1);

            expect(list.movies[1].name).toBe("Sherlock Holmes: A Game of Shadows");
            expect(list.movies[1].year).toBe(2011);
            expect(list.movies[1].position).toBe(2);

            expect(list.movies[2].name).toBe("Sherlock: The Abominable Bride");
            expect(list.movies[2].year).toBe(2016);
            expect(list.movies[2].position).toBe(3);
        });
    });
});
