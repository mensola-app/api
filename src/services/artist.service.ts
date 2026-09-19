import pool from "@/config/db";
import { artistQueries } from "@/queries/artist.queries";
import { ToggleArtistFollowResult } from "@/types/artist.types";

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
