import pool from "@/config/db";
import { trackQueries } from "@/queries/track.queries";
import { SpotifyId, UserId, TrackId } from "@/types/common.types";
import {
    GetLikedTracksDto,
    GetLikedTracksResponse,
    GetLikedTracksResponseItem,
    GetTrackInteractionsDto,
    UpsertTrackInteractionDto,
} from "@/types/track.types";
import { ApiError } from "@/utils/error";
import { upsertInteractionComment } from "@/utils/interaction";
import { spotifyService } from "./spotify.service";
import { albumQueries } from "@/queries/album.queries";
import { artistQueries } from "@/queries/artist.queries";
import { invalidateUserProfile } from "@/utils/cache";

/**
 * Retrieves a paginated list of liked tracks for a user.
 *
 * @param dto - Data transfer object containing userId, page, and limit.
 * @returns A promise that resolves to a paginated list of liked tracks.
 */
export const getLikedTracks = async (dto: GetLikedTracksDto): Promise<GetLikedTracksResponse> => {
    const offset = (dto.page - 1) * dto.limit;

    const result = await pool.query<GetLikedTracksResponseItem>(trackQueries.likes.get, [
        dto.userId,
        dto.limit,
        offset,
    ]);

    return result.rows;
};

export const getFavoriteTracks = async (dto: GetLikedTracksDto): Promise<GetLikedTracksResponse> => {
    const offset = (dto.page - 1) * dto.limit;

    const result = await pool.query<GetLikedTracksResponseItem>(trackQueries.favorites.get, [
        dto.userId,
        dto.limit,
        offset,
    ]);

    return result.rows;
};

export const addTrackToFavorites = async (
    userId: UserId,
    data: { trackId?: TrackId; spotifyId?: SpotifyId; replaceTrackId?: TrackId }
) => {
    const { trackId, spotifyId, replaceTrackId } = data;

    // 1. Eğer replaceTrackId verilmişse eski favoriyi kaldır
    if (replaceTrackId) {
        await pool.query(trackQueries.favorites.remove, [userId, replaceTrackId]);
    }

    // 2. Eğer trackId yoksa ama spotifyId varsa şarkıyı bul veya spotify'dan çek
    let targetTrackId: TrackId | undefined = trackId;
    if (!targetTrackId && spotifyId) {
        const trackCheck = await pool.query(trackQueries.checkExists, [spotifyId]);
        if (trackCheck.rows.length > 0) {
            targetTrackId = trackCheck.rows[0].id;
        } else {
            const fetched = await findOrFetchSpotifyTrack(spotifyId, userId);
            targetTrackId = fetched.id;
        }
    }

    if (!targetTrackId) {
        throw new ApiError("NOT_FOUND", 404);
    }

    // 3. Limit kontrolü
    const countResult = await pool.query(
        `SELECT COUNT(*) FROM "PlaylistItem" pli
         JOIN "Playlist" pl ON pl.id = pli."playlistId"
         WHERE pl."listType" = 'favorites' AND pl."creatorId" = $1`,
        [userId]
    );

    const count = parseInt(countResult.rows[0].count, 10);
    if (count >= 3) {
        throw new ApiError("MAX_FAVORITES_TRACK_REACHED", 400);
    }

    // Check if the track exists
    const trackCheck = await pool.query(`SELECT id FROM "Track" WHERE id = $1`, [targetTrackId]);
    if (trackCheck.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    const result = await pool.query(trackQueries.favorites.add, [userId, targetTrackId]);
    await invalidateUserProfile(userId);
    return result.rows[0];
};

export const removeTrackFromFavorites = async (trackId: string, userId: string) => {
    // Check if the track exists
    const trackCheck = await pool.query(`SELECT id FROM "Track" WHERE id = $1`, [trackId]);
    if (trackCheck.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    const result = await pool.query(trackQueries.favorites.remove, [userId, trackId]);
    await invalidateUserProfile(userId);
    return result.rows[0] || { trackId, isFavorite: false };
};

/**
 * Retrieves track details by its ID, optionally including the current user's interactions.
 *
 * @param trackId - The ID of the track to retrieve.
 * @param userId - Optional ID of the user requesting the track to include their interactions.
 * @returns A promise that resolves to the track details.
 */
export const getTrackById = async (trackId: string, userId?: string) => {
    const result = await pool.query(trackQueries.getById, [trackId, userId || null]);
    if (result.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }
    return result.rows[0];
};

/**
 * Likes a track for the authenticated user.
 *
 * @param trackId - The ID of the track to like.
 * @param userId - The ID of the user.
 * @returns An object containing trackId and isLiked status.
 */
export const likeTrack = async (trackId: string, userId: string) => {
    // Check if the track exists
    const trackCheck = await pool.query(`SELECT id FROM "Track" WHERE id = $1`, [trackId]);
    if (trackCheck.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    const result = await pool.query(trackQueries.likes.add, [userId, trackId]);
    await invalidateUserProfile(userId);
    return result.rows[0];
};

/**
 * Unlikes a track for the authenticated user.
 *
 * @param trackId - The ID of the track to unlike.
 * @param userId - The ID of the user.
 * @returns An object containing trackId and isLiked status.
 */
export const unlikeTrack = async (trackId: string, userId: string) => {
    // Check if the track exists
    const trackCheck = await pool.query(`SELECT id FROM "Track" WHERE id = $1`, [trackId]);
    if (trackCheck.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    const result = await pool.query(trackQueries.likes.remove, [userId, trackId]);
    await invalidateUserProfile(userId);
    return result.rows[0] || { trackId, isLiked: false };
};

/**
 * Retrieves all interactions/comments for a specific track.
 *
 * @param dto - Data transfer object containing trackId, page, and limit.
 * @returns A promise that resolves to a list of interactions with comments.
 */
export const getTrackInteractions = async (dto: GetTrackInteractionsDto) => {
    const { trackId, currentUserId, page, limit } = dto;
    const offset = (page - 1) * limit;

    let targetTrackId = trackId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trackId);
    if (!isUuid) {
        const trackRow = await pool.query<{ id: string }>('SELECT id FROM "Track" WHERE "spotifyId" = $1 LIMIT 1', [trackId]);
        if (trackRow.rows.length > 0) {
            targetTrackId = trackRow.rows[0].id as TrackId;
        } else {
            return [];
        }
    }

    const result = await pool.query(trackQueries.items.getInteractions, [targetTrackId, limit, offset, currentUserId || null]);

    return result.rows;
};

/**
 * Upserts a user interaction (rating, comment, isLiked) for a track.
 *
 * @param dto - Data transfer object containing userId, trackId, rating, comment, isLiked.
 * @returns A promise that resolves to the saved interaction details.
 */
export const upsertTrackInteraction = async (dto: UpsertTrackInteractionDto) => {
    const { userId, trackId, rating, comment, isLiked } = dto;
    const ratingVal = typeof rating === "number" && rating >= 0 ? rating : null;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const trackCheck = await client.query(`SELECT id FROM "Track" WHERE id = $1`, [trackId]);
        if (trackCheck.rows.length === 0) {
            throw new ApiError("NOT_FOUND", 404);
        }

        const interactionResult = await client.query(trackQueries.interaction.upsert, [
            userId,
            trackId,
            ratingVal,
            isLiked ?? false,
        ]);
        const interaction = interactionResult.rows[0];

        const commentData = await upsertInteractionComment(client, interaction.id, userId, comment);

        await client.query(trackQueries.interaction.cleanupEmpty, [interaction.id]);

        await client.query("COMMIT");

        return {
            id: interaction.id,
            trackId,
            rating: interaction.rating,
            isLiked: interaction.isLiked,
            comment: commentData
                ? { id: commentData.id, content: commentData.content, date: commentData.createdAt }
                : null,
        };
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
};

const getOrInsertArtist = async (client: any, artist: { spotifyId: string; name: string }) => {
    const artistCheck = await client.query(artistQueries.checkExists, [artist.spotifyId]);
    if (artistCheck.rows.length > 0) {
        return artistCheck.rows[0].id;
    }
    const insertResult = await client.query(artistQueries.insertArtist, [artist.spotifyId, artist.name, null]);
    return insertResult.rows[0].id;
};

export const findOrFetchSpotifyTrack = async (spotifyId: SpotifyId, userId?: UserId) => {
    const trackCheck = await pool.query(trackQueries.checkExists, [spotifyId]);

    let trackId: number;

    if (trackCheck.rows.length > 0) {
        trackId = trackCheck.rows[0].id;
    } else {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const trackData = await spotifyService.getTrackBySpotifyId(spotifyId);

            let albumId: number;
            const albumCheck = await client.query(albumQueries.checkExists, [trackData.album?.spotifyId]);

            if (albumCheck.rows.length > 0) {
                albumId = albumCheck.rows[0].id;
            } else {
                const albumData = trackData.album;
                const albumValues = [
                    albumData?.spotifyId,
                    albumData?.title,
                    albumData?.image,
                    albumData?.releaseDate,
                    albumData?.songCount,
                ];
                const insertAlbumResult = await client.query(albumQueries.insertAlbum, albumValues);
                albumId = insertAlbumResult.rows[0].id;

                for (const artist of albumData?.artists ?? []) {
                    const artistId = await getOrInsertArtist(client, artist);
                    await client.query(albumQueries.insertAlbumArtist, [albumId, artistId]);
                }
            }

            const trackValues = [trackData.spotifyId, trackData.title, trackData.duration, trackData.image, albumId];
            const insertTrackResult = await client.query(trackQueries.insertTrack, trackValues);
            trackId = insertTrackResult.rows[0].id;

            for (const artist of trackData.artists ?? []) {
                const artistId = await getOrInsertArtist(client, artist);
                await client.query(trackQueries.insertTrackArtist, [trackId, artistId]);
            }

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    const finalResult = await pool.query(trackQueries.getById, [trackId, userId || null]);
    return finalResult.rows[0];
};
