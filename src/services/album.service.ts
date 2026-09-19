import pool from "@/config/db";
import { albumQueries } from "@/queries/album.queries";
import { artistQueries } from "@/queries/artist.queries";
import { trackQueries } from "@/queries/track.queries";
import { spotifyService } from "@/services/spotify.service";
import { AlbumId, SpotifyId, UserId } from "@/types/common.types";
import { invalidateUserProfile } from "@/utils/cache";
import {
    GetLikedAlbumsDto,
    GetLikedAlbumsResponse,
    GetLikedAlbumsResponseItem,
    GetAlbumDetailsDto,
    GetAlbumDetailsResponse,
    GetAlbumTracksDto,
    GetAlbumTracksResponse,
    AlbumTrackResponseItem,
    LikeAlbumDto,
    UnlikeAlbumDto,
    LikeAlbumResponse,
    UnlikeAlbumResponse,
    GetAlbumInteractionsDto,
    UpsertAlbumInteractionDto,
} from "@/types/album.types";
import { ApiError } from "@/utils/error";
import { upsertInteractionComment } from "@/utils/interaction";

/**
 * Retrieves albums liked by a specific user.
 *
 * @param dto - Data transfer object containing userId, page, and limit.
 * @returns A promise that resolves to a paginated list of liked albums.
 */
export const getLikedAlbums = async (dto: GetLikedAlbumsDto): Promise<GetLikedAlbumsResponse> => {
    const offset = (dto.page - 1) * dto.limit;

    const result = await pool.query<GetLikedAlbumsResponseItem>(albumQueries.likes.get, [
        dto.userId,
        dto.limit,
        offset,
    ]);

    return result.rows;
};

/**
 * Retrieves detailed information for a specific album.
 *
 * @param dto - Data transfer object containing albumId and optional currentUserId.
 * @returns A promise that resolves to album details.
 */
export const getAlbumById = async (dto: GetAlbumDetailsDto): Promise<GetAlbumDetailsResponse> => {
    const { albumId, currentUserId = null } = dto;

    const result = await pool.query<GetAlbumDetailsResponse>(albumQueries.getById, [albumId, currentUserId]);

    const album = result.rows[0];

    if (!album) {
        throw new ApiError("NOT_FOUND", 404);
    }

    return album;
};

/**
 * Retrieves tracks/songs within a specific album.
 *
 * @param dto - Data transfer object containing albumId, currentUserId, page, and limit.
 * @returns A promise that resolves to a list of album tracks.
 */
export const getAlbumTracks = async (dto: GetAlbumTracksDto): Promise<GetAlbumTracksResponse> => {
    const { albumId, currentUserId = null, page, limit } = dto;
    const offset = (page - 1) * limit;

    const albumExists = await pool.query(albumQueries.tracks.checkExists, [albumId]);
    if (albumExists.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    const result = await pool.query<AlbumTrackResponseItem>(albumQueries.tracks.get, [
        albumId,
        currentUserId,
        limit,
        offset,
    ]);

    return result.rows;
};

/**
 * Likes an album for the authenticated user.
 *
 * @param dto - Data transfer object containing userId and albumId.
 * @returns An object containing albumId and isLiked status.
 */
export const likeAlbum = async (dto: LikeAlbumDto): Promise<LikeAlbumResponse> => {
    const { userId, albumId } = dto;

    const albumExists = await pool.query(albumQueries.tracks.checkExists, [albumId]);
    if (albumExists.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    const result = await pool.query<LikeAlbumResponse>(albumQueries.likes.add, [userId, albumId]);
    await invalidateUserProfile(userId);
    return result.rows[0];
};

/**
 * Unlikes an album for the authenticated user.
 *
 * @param dto - Data transfer object containing userId and albumId.
 * @returns An object containing albumId and isLiked status.
 */
export const unlikeAlbum = async (dto: UnlikeAlbumDto): Promise<UnlikeAlbumResponse> => {
    const { userId, albumId } = dto;

    const albumExists = await pool.query(albumQueries.tracks.checkExists, [albumId]);
    if (albumExists.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    const result = await pool.query<UnlikeAlbumResponse>(albumQueries.likes.remove, [userId, albumId]);
    await invalidateUserProfile(userId);
    return result.rows[0] || { albumId, isLiked: false };
};

/**
 * Retrieves all interactions/comments for a specific album.
 *
 * @param dto - Data transfer object containing albumId, page, and limit.
 * @returns A promise that resolves to a list of interactions with comments.
 */
export const getAlbumInteractions = async (dto: GetAlbumInteractionsDto) => {
    const { albumId, currentUserId, page, limit } = dto;
    const offset = (page - 1) * limit;

    let targetAlbumId = albumId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(albumId);
    if (!isUuid) {
        const albumRow = await pool.query<{ id: string }>('SELECT id FROM "Album" WHERE "spotifyId" = $1 LIMIT 1', [
            albumId,
        ]);
        if (albumRow.rows.length > 0) {
            targetAlbumId = albumRow.rows[0].id as AlbumId;
        } else {
            return [];
        }
    }

    const result = await pool.query(albumQueries.interaction.get, [
        targetAlbumId,
        limit,
        offset,
        currentUserId || null,
    ]);

    return result.rows;
};

/**
 * Upserts a user interaction (rating, comment, isLiked) for an album.
 *
 * @param dto - Data transfer object containing userId, albumId, rating, comment, isLiked.
 * @returns A promise that resolves to the saved interaction details.
 */
export const upsertAlbumInteraction = async (dto: UpsertAlbumInteractionDto) => {
    const { userId, albumId, rating, comment, isLiked } = dto;
    const ratingVal = typeof rating === "number" && rating >= 0 ? rating : null;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const albumExists = await client.query(albumQueries.tracks.checkExists, [albumId]);
        if (albumExists.rows.length === 0) {
            throw new ApiError("NOT_FOUND", 404);
        }

        const interactionResult = await client.query(albumQueries.interaction.upsert, [
            userId,
            albumId,
            ratingVal,
            isLiked ?? false,
        ]);
        const interaction = interactionResult.rows[0];

        const commentData = await upsertInteractionComment(client, interaction.id, userId, comment);

        await client.query(albumQueries.interaction.cleanupEmpty, [interaction.id]);

        await client.query("COMMIT");

        return {
            id: interaction.id,
            albumId,
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

export const findOrFetchSpotifyAlbum = async (spotifyId: SpotifyId, currentUserId?: UserId) => {
    const albumCheck = await pool.query(albumQueries.checkExists, [spotifyId]);

    let albumId: string;

    if (albumCheck.rows.length > 0) {
        albumId = albumCheck.rows[0].id;
    } else {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const albumData = await spotifyService.getAlbumBySpotifyId(spotifyId);

            const albumValues = [
                albumData.spotifyId,
                albumData.title,
                albumData.image,
                albumData.releaseDate,
                albumData.songCount,
            ];
            const insertAlbumResult = await client.query(albumQueries.insertAlbum, albumValues);
            albumId = insertAlbumResult.rows[0].id;

            for (const artist of albumData.artists ?? []) {
                const artistId = await getOrInsertArtist(client, artist);
                await client.query(albumQueries.insertAlbumArtist, [albumId, artistId]);
            }

            for (const track of albumData.tracks ?? []) {
                const trackCheck = await client.query(trackQueries.checkExists, [track.spotifyId]);
                let trackId: string;
                if (trackCheck.rows.length > 0) {
                    trackId = trackCheck.rows[0].id;
                } else {
                    const trackValues = [track.spotifyId, track.title, track.duration, track.image, albumId];
                    const insertTrackResult = await client.query(trackQueries.insertTrack, trackValues);
                    trackId = insertTrackResult.rows[0].id;

                    for (const artist of track.artists ?? []) {
                        const artistId = await getOrInsertArtist(client, artist);
                        await client.query(trackQueries.insertTrackArtist, [trackId, artistId]);
                    }
                }
            }

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    const finalResult = await pool.query(albumQueries.getById, [albumId, currentUserId || null]);
    return finalResult.rows[0];
};
