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
    // Treat as Spotify ID
    return { dbId: null, spotifyId: id };
};

/**
 * Retrieves full artist details including top tracks (Redis-cached) and follow status.
 *
 * Flow:
 *  1. Resolve whether the :id param is a DB UUID or a Spotify ID.
 *  2. Check if artist exists in DB; if not, fetch from Spotify and upsert.
 *  3. Get top tracks from Redis cache; if miss, fetch from Spotify and cache for 24h.
 *  4. Get in-app follower count and current user's follow status.
 *  5. Return assembled response.
 */
export const getArtistById = async (
    id: string,
    currentUserId?: string,
): Promise<ArtistDetailResponse> => {
    // 1. Resolve artist identifier
    const { dbId, spotifyId } = await resolveArtistIdentifier(id);

    // 2. Ensure artist exists in DB (upsert from Spotify if needed)
    let artist: { id: string; spotifyId: string; name: string; image?: string };

    if (dbId) {
        const dbResult = await pool.query(artistQueries.findById, [dbId]);
        artist = dbResult.rows[0];
        if (!artist.image && artist.spotifyId) {
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
    } else {
        const dbCheck = await pool.query(artistQueries.checkExists, [spotifyId]);
        if (dbCheck.rows.length > 0) {
            artist = dbCheck.rows[0];
            if (!artist.image) {
                try {
                    const spotifyArtist = await spotifyService.getArtistBySpotifyId(spotifyId as SpotifyId);
                    if (spotifyArtist.image) {
                        await pool.query('UPDATE "Artist" SET image = $1 WHERE id = $2', [spotifyArtist.image, artist.id]);
                        artist.image = spotifyArtist.image;
                    }
                } catch (e) {
                    console.warn("[ArtistService] Failed to fetch missing artist image from Spotify:", e);
                }
            }
        } else {
            // Fetch from Spotify and upsert into DB
            const spotifyArtist = await spotifyService.getArtistBySpotifyId(spotifyId as SpotifyId);
            const upsertResult = await pool.query(artistQueries.upsertArtist, [
                spotifyArtist.spotifyId,
                spotifyArtist.name,
                spotifyArtist.image ?? null,
            ]);
            artist = upsertResult.rows[0];
        }
    }

    // 3. Get top tracks — Redis-cached with 24h TTL
    const cacheKey = `${TOP_TRACKS_CACHE_PREFIX}${artist.spotifyId}${TOP_TRACKS_CACHE_SUFFIX}`;
    const topTracks = await getOrSetCache<ArtistTopTrack[]>(
        cacheKey,
        TOP_TRACKS_TTL_SECONDS,
        async () => {
            try {
                return await spotifyService.getArtistTopTracks(artist.spotifyId as SpotifyId);
            } catch (err: any) {
                if (err.message === "FORBIDDEN_TOP_TRACKS") {
                    console.warn(`[ArtistService] top-tracks forbidden for ${artist.spotifyId}, falling back to search API`);
                    // Fallback to searching tracks by artist name
                    const searchRes = await spotifyService.searchTracks(`artist:${artist.name}`, 1, 10);
                    return searchRes.items.map((t: any) => ({
                        spotifyId: t.spotifyId,
                        title: t.title,
                        duration: t.duration,
                        image: t.image,
                        artists: t.artists || [],
                        album: t.album,
                    }));
                }
                throw err;
            }
        }
    );

    // 4. Get in-app follower count
    const followerResult = await pool.query(artistQueries.follow.getFollowerCount, [artist.spotifyId]);
    const followerCount = followerResult.rows[0]?.followerCount ?? 0;

    // 5. Check if current user is following
    let isFollowing = false;
    if (currentUserId) {
        const followCheck = await pool.query(artistQueries.follow.check, [currentUserId, artist.spotifyId]);
        isFollowing = followCheck.rows.length > 0;
    }

    // 6. Fetch Spotify-side metadata (followers, genres) for the response
    //    Use a separate cache to avoid hitting Spotify on every request
    const spotifyMeta = await getOrSetCache<{ genres: string[]; spotifyFollowers: number }>(
        `${TOP_TRACKS_CACHE_PREFIX}${artist.spotifyId}:meta`,
        TOP_TRACKS_TTL_SECONDS,
        async () => {
            const data = await spotifyService.getArtistBySpotifyId(artist.spotifyId as SpotifyId);
            return { genres: data.genres, spotifyFollowers: data.followers };
        },
    );

    // 7. Get albums preview (limit 5) — Redis-cached with 3 days TTL
    const albumsPreviewKey = `artist:${artist.spotifyId}:albums:preview`;
    let albums: ArtistAlbumItem[] = [];
    try {
        albums = await getOrSetCache<ArtistAlbumItem[]>(
            albumsPreviewKey,
            ALBUMS_PREVIEW_TTL_SECONDS,
            async () => {
                const res = await spotifyService.getArtistAlbums(artist.spotifyId, 5, 0);
                return res.items;
            },
        );
    } catch (err: any) {
        console.warn(`[ArtistService] Failed to fetch albums preview for ${artist.spotifyId}:`, err?.message || err);
    }

    return {
        id: artist.id,
        spotifyId: artist.spotifyId,
        name: artist.name,
        image: artist.image,
        genres: spotifyMeta.genres,
        spotifyFollowers: spotifyMeta.spotifyFollowers,
        followerCount,
        isFollowing,
        topTracks,
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
    const fullCacheKey = `artist:${spotifyId}:discography:full`;

    // 1. Check if full discography is cached in Redis
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

    // 2. Cache miss: Fetch requested page from Spotify immediately
    const offset = (page - 1) * limit;
    const spotifyRes = await spotifyService.getArtistAlbums(spotifyId, limit, offset);
    const items = spotifyRes.items;
    const totalResults = spotifyRes.total;
    const hasMore = offset + items.length < totalResults;
    const totalPages = Math.ceil(totalResults / limit) || 1;

    // 3. Populate full cache in background (or immediately if total <= limit on page 1)
    if (totalResults <= items.length && page === 1) {
        setCache(fullCacheKey, items, DISCOGRAPHY_FULL_TTL_SECONDS).catch((err) =>
            console.error("[ArtistService] Failed to set full discography cache:", err)
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
};
