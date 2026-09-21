import pool from "@/config/db";
import { artistQueries } from "@/queries/artist.queries";
import { spotifyService } from "@/services/spotify.service";
import {
    ArtistAlbumItem,
    ArtistDetailResponse,
    ArtistDiscographyResponseData,
    ArtistTopTrack,
    ToggleArtistFollowResult,
} from "@/types/artist.types";
import { SpotifyId } from "@/types/common.types";
import { ApiError } from "@/utils/error";
import { getCache, getOrSetCache, setCache } from "@/utils/cache";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPOTIFY_ID_REGEX = /^[0-9A-Za-z]{22}$/;

export const isValidSpotifyId = (id?: string | null): boolean => {
    return typeof id === "string" && SPOTIFY_ID_REGEX.test(id);
};

const TOP_TRACKS_CACHE_PREFIX = "artist:";
const TOP_TRACKS_CACHE_SUFFIX = ":top-tracks";
const TOP_TRACKS_TTL_SECONDS = 86400; // 24 hours
const ALBUMS_PREVIEW_TTL_SECONDS = 3 * 86400; // 3 days (259200s)
const DISCOGRAPHY_FULL_TTL_SECONDS = 3 * 86400; // 3 days (259200s)

const backgroundFetchingArtists = new Set<string>();

/**
 * Resolves the Spotify ID from a param that could be either a DB UUID or a Spotify ID.
 * If it's a UUID, looks up the Artist table to get the spotifyId.
 * Returns both internal id (if exists) and spotifyId.
 */
const resolveArtistIdentifier = async (
    id: string,
): Promise<{ dbId: string | null; spotifyId: string }> => {
    if (UUID_REGEX.test(id)) {
        // It's a UUID — look up internal Artist table
        const result = await pool.query(artistQueries.findById, [id]);
        if (result.rows.length === 0) {
            throw new ApiError("NOT_FOUND", 404);
        }
        return { dbId: result.rows[0].id, spotifyId: result.rows[0].spotifyId };
    }

    // Check if it exists in DB by spotifyId (e.g. real 22-char or synthetic art_...)
    const dbCheck = await pool.query(artistQueries.checkExists, [id]);
    if (dbCheck.rows.length > 0) {
        return { dbId: dbCheck.rows[0].id, spotifyId: dbCheck.rows[0].spotifyId };
    }

    // Treat as Spotify ID
    return { dbId: null, spotifyId: id };
};

/**
 * Retrieves full artist details including top tracks (Redis-cached) and follow status.
 *
 * Flow:
 *  1. Resolve whether the :id param is a DB UUID or a Spotify ID.
 *  2. Check if artist exists in DB; if not, fetch from Spotify and upsert.
 *  3. Auto-heal synthetic or invalid spotifyIds if found.
 *  4. Get top tracks from Redis cache; if miss, fetch from Spotify and cache for 24h with safe fallbacks.
 *  5. Get in-app follower count and current user's follow status.
 *  6. Get Spotify-side metadata (followers, genres) with safe fallback.
 *  7. Get albums preview with safe fallback.
 *  8. Return assembled response.
 */
export const getArtistById = async (
    id: string,
    currentUserId?: string,
): Promise<ArtistDetailResponse> => {
    // 1. Resolve artist identifier
    const { dbId, spotifyId } = await resolveArtistIdentifier(id);

    // 2. Ensure artist exists in DB (upsert from Spotify if needed)
    let artist: { id: string; spotifyId: string; name: string; image?: string | null };

    if (dbId) {
        const dbResult = await pool.query(artistQueries.findById, [dbId]);
        artist = dbResult.rows[0];
    } else {
        const dbCheck = await pool.query(artistQueries.checkExists, [spotifyId]);
        if (dbCheck.rows.length > 0) {
            artist = dbCheck.rows[0];
        } else if (isValidSpotifyId(spotifyId)) {
            // Fetch from Spotify and upsert into DB
            try {
                const spotifyArtist = await spotifyService.getArtistBySpotifyId(spotifyId as SpotifyId);
                const upsertResult = await pool.query(artistQueries.upsertArtist, [
                    spotifyArtist.spotifyId,
                    spotifyArtist.name,
                    spotifyArtist.image ?? null,
                ]);
                artist = upsertResult.rows[0];
            } catch (spotifyErr) {
                console.warn(`[ArtistService] Failed to fetch artist by Spotify ID ${spotifyId}:`, spotifyErr);
                throw new ApiError("NOT_FOUND", 404);
            }
        } else {
            // Try to search Spotify by name if query might be artist name
            try {
                const searchResults = await spotifyService.searchArtists(id, 1, 1);
                if (searchResults.length > 0 && isValidSpotifyId(searchResults[0].spotifyId)) {
                    const match = searchResults[0];
                    const upsertResult = await pool.query(artistQueries.upsertArtist, [
                        match.spotifyId,
                        match.name,
                        match.image ?? null,
                    ]);
                    artist = upsertResult.rows[0];
                } else {
                    throw new ApiError("NOT_FOUND", 404);
                }
            } catch {
                throw new ApiError("NOT_FOUND", 404);
            }
        }
    }

    // Auto-heal synthetic or invalid spotifyId
    if (!isValidSpotifyId(artist.spotifyId)) {
        try {
            const matches = await spotifyService.searchArtists(artist.name, 1, 1);
            const match = matches[0];
            if (match && isValidSpotifyId(match.spotifyId)) {
                const existing = await pool.query<{ id: string; spotifyId: string; name: string; image: string | null }>(
                    'SELECT id, "spotifyId", name, image FROM "Artist" WHERE "spotifyId" = $1 AND id != $2',
                    [match.spotifyId, artist.id],
                );
                if (existing.rows.length > 0) {
                    const canonical = existing.rows[0];
                    // Re-point relations and delete duplicate
                    await pool.query(
                        'DELETE FROM "TrackArtist" WHERE "artistId" = $1 AND "trackId" IN (SELECT "trackId" FROM "TrackArtist" WHERE "artistId" = $2)',
                        [artist.id, canonical.id],
                    );
                    await pool.query(
                        'UPDATE "TrackArtist" SET "artistId" = $1 WHERE "artistId" = $2',
                        [canonical.id, artist.id],
                    );
                    await pool.query(
                        'DELETE FROM "AlbumArtist" WHERE "artistId" = $1 AND "albumId" IN (SELECT "albumId" FROM "AlbumArtist" WHERE "artistId" = $2)',
                        [artist.id, canonical.id],
                    );
                    await pool.query(
                        'UPDATE "AlbumArtist" SET "artistId" = $1 WHERE "artistId" = $2',
                        [canonical.id, artist.id],
                    );
                    await pool.query('DELETE FROM "Artist" WHERE id = $1', [artist.id]);
                    artist = canonical;
                } else {
                    await pool.query(
                        'UPDATE "Artist" SET "spotifyId" = $1, image = COALESCE(image, $2) WHERE id = $3',
                        [match.spotifyId, match.image, artist.id],
                    );
                    artist.spotifyId = match.spotifyId;
                    if (!artist.image && match.image) {
                        artist.image = match.image;
                    }
                }
            }
        } catch (healErr) {
            console.warn(`[ArtistService] Auto-heal failed for artist "${artist.name}":`, healErr);
        }
    }

    // Fetch missing image if artist has valid Spotify ID
    if (!artist.image && isValidSpotifyId(artist.spotifyId)) {
        try {
            const spotifyArtist = await spotifyService.getArtistBySpotifyId(artist.spotifyId as SpotifyId);
            if (spotifyArtist.image) {
                await pool.query('UPDATE "Artist" SET image = $1 WHERE id = $2', [spotifyArtist.image, artist.id]);
                artist.image = spotifyArtist.image;
            }
        } catch (e) {
            console.warn("[ArtistService] Failed to fetch missing artist image from Spotify:", e);
        }
    }

    // 3. Get top tracks — Redis-cached with 24h TTL
    const cacheKey = `${TOP_TRACKS_CACHE_PREFIX}${artist.spotifyId}${TOP_TRACKS_CACHE_SUFFIX}`;
    let topTracks: ArtistTopTrack[] = [];
    try {
        topTracks = await getOrSetCache<ArtistTopTrack[]>(
            cacheKey,
            TOP_TRACKS_TTL_SECONDS,
            async () => {
                if (isValidSpotifyId(artist.spotifyId)) {
                    try {
                        return await spotifyService.getArtistTopTracks(artist.spotifyId as SpotifyId);
                    } catch (err: any) {
                        if (err.message !== "FORBIDDEN_TOP_TRACKS") {
                            console.warn(`[ArtistService] getArtistTopTracks failed for ${artist.spotifyId}:`, err?.message || err);
                        }
                    }
                }

                // Fallback 1: Search tracks by artist name on Spotify
                try {
                    const searchRes = await spotifyService.searchTracks(`artist:${artist.name}`, 1, 10);
                    if (searchRes.items && searchRes.items.length > 0) {
                        return searchRes.items.map((t: any) => ({
                            spotifyId: t.spotifyId,
                            title: t.title,
                            duration: t.duration,
                            image: t.image,
                            artists: t.artists || [],
                            album: t.album,
                        }));
                    }
                } catch (searchErr) {
                    console.warn(`[ArtistService] searchTracks fallback failed for "${artist.name}":`, searchErr);
                }

                // Fallback 2: Local DB tracks linked to this artist
                try {
                    const localTracks = await pool.query(
                        `SELECT t.id, t."spotifyId", t.title, t.duration, t.image,
                                json_build_object('spotifyId', a."spotifyId", 'title', a.title, 'coverUrl', a.image) as album
                         FROM "Track" t
                         JOIN "TrackArtist" ta ON ta."trackId" = t.id
                         LEFT JOIN "Album" a ON a.id = t."albumId"
                         WHERE ta."artistId" = $1
                         LIMIT 10`,
                        [artist.id],
                    );
                    return localTracks.rows.map((r: any) => ({
                        spotifyId: r.spotifyId,
                        title: r.title,
                        duration: r.duration,
                        image: r.image,
                        artists: [{ id: artist.id, spotifyId: artist.spotifyId, name: artist.name }],
                        album: r.album,
                    }));
                } catch {
                    return [];
                }
            },
        );
    } catch (topErr) {
        console.warn(`[ArtistService] Error resolving top tracks for ${artist.name}:`, topErr);
        topTracks = [];
    }

    // 4. Get in-app follower count
    let followerCount = 0;
    try {
        const followerResult = await pool.query(artistQueries.follow.getFollowerCount, [artist.spotifyId]);
        followerCount = followerResult.rows[0]?.followerCount ?? 0;
    } catch (err) {
        console.warn(`[ArtistService] Error getting follower count:`, err);
    }

    // 5. Check if current user is following
    let isFollowing = false;
    if (currentUserId) {
        try {
            const followCheck = await pool.query(artistQueries.follow.check, [currentUserId, artist.spotifyId]);
            isFollowing = followCheck.rows.length > 0;
        } catch (err) {
            console.warn(`[ArtistService] Error checking user follow status:`, err);
        }
    }

    // 6. Fetch Spotify-side metadata (followers, genres) with safe fallback
    let spotifyMeta = { genres: [] as string[], spotifyFollowers: 0 };
    if (isValidSpotifyId(artist.spotifyId)) {
        try {
            spotifyMeta = await getOrSetCache<{ genres: string[]; spotifyFollowers: number }>(
                `${TOP_TRACKS_CACHE_PREFIX}${artist.spotifyId}:meta`,
                TOP_TRACKS_TTL_SECONDS,
                async () => {
                    const data = await spotifyService.getArtistBySpotifyId(artist.spotifyId as SpotifyId);
                    return { genres: data.genres || [], spotifyFollowers: data.followers || 0 };
                },
            );
        } catch (metaErr) {
            console.warn(`[ArtistService] Failed to fetch spotifyMeta for ${artist.spotifyId}:`, metaErr);
        }
    }

    // 7. Get albums preview (limit 5) — Redis-cached with 3 days TTL
    const albumsPreviewKey = `artist:${artist.spotifyId}:albums:preview`;
    let albums: ArtistAlbumItem[] = [];
    if (isValidSpotifyId(artist.spotifyId)) {
        try {
            albums = await getOrSetCache<ArtistAlbumItem[]>(
                albumsPreviewKey,
                ALBUMS_PREVIEW_TTL_SECONDS,
                async () => {
                    const res = await spotifyService.getArtistAlbums(artist.spotifyId, 5, 0);
                    return res.items || [];
                },
            );
        } catch (err: any) {
            console.warn(`[ArtistService] Failed to fetch albums preview for ${artist.spotifyId}:`, err?.message || err);
        }
    }

    return {
        id: artist.id,
        spotifyId: artist.spotifyId,
        name: artist.name,
        image: artist.image || undefined,
        genres: spotifyMeta.genres,
        spotifyFollowers: spotifyMeta.spotifyFollowers,
        followerCount,
        isFollowing,
        topTracks: topTracks || [],
        albums: albums || [],
    };
};

// ─── Follow / Unfollow (existing) ────────────────────────────────────────────

/**
 * Follows an artist for the given user. Idempotent — safe to call multiple times.
 *
 * @param userId - The authenticated user's UUID.
 * @param artistId - The Spotify ID of the artist to follow.
 * @returns Follow result with isFollowing status.
 */
export const followArtist = async (
    userId: string,
    artistId: string,
): Promise<ToggleArtistFollowResult> => {
    await pool.query(artistQueries.follow.add, [userId, artistId]);
    return { artistId, isFollowing: true };
};

/**
 * Unfollows an artist for the given user. Idempotent — safe to call even if not following.
 *
 * @param userId - The authenticated user's UUID.
 * @param artistId - The Spotify ID of the artist to unfollow.
 * @returns Unfollow result with isFollowing status.
 */
export const unfollowArtist = async (
    userId: string,
    artistId: string,
): Promise<ToggleArtistFollowResult> => {
    await pool.query(artistQueries.follow.remove, [userId, artistId]);
    return { artistId, isFollowing: false };
};

/**
 * Checks whether a user is following a specific artist.
 *
 * @param userId - The authenticated user's UUID.
 * @param artistId - The Spotify ID of the artist.
 * @returns true if following, false otherwise.
 */
export const isFollowingArtist = async (
    userId: string,
    artistId: string,
): Promise<boolean> => {
    const result = await pool.query(artistQueries.follow.check, [userId, artistId]);
    return result.rows.length > 0;
};

/**
 * Retrieves the full discography of an artist with pagination.
 * If cached in Redis (artist:{id}:discography:full), slices and returns immediately.
 * If not cached, fetches the requested page from Spotify immediately to return to the caller,
 * and asynchronously fetches all remaining pages in the background to populate the 3-day Redis cache.
 */
export const getArtistDiscography = async (
    id: string,
    page: number = 1,
    limit: number = 10,
): Promise<ArtistDiscographyResponseData> => {
    const { spotifyId } = await resolveArtistIdentifier(id);
    if (!isValidSpotifyId(spotifyId)) {
        return {
            items: [],
            page,
            limit,
            hasMore: false,
            totalResults: 0,
            totalPages: 1,
        };
    }
    const fullCacheKey = `artist:${spotifyId}:discography:full`;

    // 1. Check if full discography is cached in Redis
    try {
        const cachedFull = await getCache<ArtistAlbumItem[]>(fullCacheKey);

        if (cachedFull && Array.isArray(cachedFull)) {
            const offset = (page - 1) * limit;
            const items = cachedFull.slice(offset, offset + limit);
            const totalResults = cachedFull.length;
            const hasMore = offset + items.length < totalResults;
            const totalPages = Math.ceil(totalResults / limit) || 1;

            return {
                items,
                page,
                limit,
                hasMore,
                totalResults,
                totalPages,
            };
        }
    } catch (cacheErr) {
        console.warn(`[ArtistService] Discography cache read error:`, cacheErr);
    }

    // 2. Cache miss: Fetch requested page from Spotify immediately
    try {
        const offset = (page - 1) * limit;
        const spotifyRes = await spotifyService.getArtistAlbums(spotifyId, limit, offset);
        const items = spotifyRes.items || [];
        const totalResults = spotifyRes.total || 0;
        const hasMore = offset + items.length < totalResults;
        const totalPages = Math.ceil(totalResults / limit) || 1;

        // 3. Populate full cache in background (or immediately if total <= limit on page 1)
        if (totalResults <= items.length && page === 1) {
            setCache(fullCacheKey, items, DISCOGRAPHY_FULL_TTL_SECONDS).catch((err) =>
                console.error("[ArtistService] Failed to set full discography cache:", err),
            );
        } else if (!backgroundFetchingArtists.has(spotifyId)) {
            backgroundFetchingArtists.add(spotifyId);
            (async () => {
                try {
                    const allAlbums = await spotifyService.getAllArtistAlbums(spotifyId);
                    if (allAlbums && allAlbums.length > 0) {
                        await setCache(fullCacheKey, allAlbums, DISCOGRAPHY_FULL_TTL_SECONDS);
                    }
                } catch (bgErr) {
                    console.warn(`[ArtistService] Background discography fetch failed for ${spotifyId}:`, bgErr);
                } finally {
                    backgroundFetchingArtists.delete(spotifyId);
                }
            })();
        }

        return {
            items,
            page,
            limit,
            hasMore,
            totalResults,
            totalPages,
        };
    } catch (discErr) {
        console.warn(`[ArtistService] Failed to fetch discography for ${spotifyId}:`, discErr);
        return {
            items: [],
            page,
            limit,
            hasMore: false,
            totalResults: 0,
            totalPages: 1,
        };
    }
};
