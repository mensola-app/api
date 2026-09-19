import pool from "@/config/db";
import { artistQueries } from "@/queries/artist.queries";
import { spotifyService } from "@/services/spotify.service";
import { ArtistDetailResponse, ArtistTopTrack, ToggleArtistFollowResult } from "@/types/artist.types";
import { SpotifyId } from "@/types/common.types";
import { ApiError } from "@/utils/error";
import { getOrSetCache } from "@/utils/cache";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOP_TRACKS_CACHE_PREFIX = "artist:";
const TOP_TRACKS_CACHE_SUFFIX = ":top-tracks";
const TOP_TRACKS_TTL_SECONDS = 86400; // 24 hours

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
    } else {
        const dbCheck = await pool.query(artistQueries.checkExists, [spotifyId]);
        if (dbCheck.rows.length > 0) {
            artist = dbCheck.rows[0];
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
        async () => spotifyService.getArtistTopTracks(artist.spotifyId as SpotifyId),
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
