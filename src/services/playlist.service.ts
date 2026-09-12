import pool from "@/config/db";
import { playlistQueries } from "@/queries/playlist.queries";
import {
    GetUserPlaylistsDto,
    GetUserPlaylistsResponse,
    GetUserPlaylistsResponseItem,
    GetLikedPlaylistsDto,
    GetLikedPlaylistsResponse,
    GetLikedPlaylistsResponseItem,
    GetPlaylistItemsDto,
    GetPlaylistItemsResponse,
    PlaylistItemResponseItem,
    GetPlaylistDetailsDto,
    GetPlaylistDetailsResponse,
    GetPlaylistInteractionsDto,
    UpsertPlaylistInteractionDto,
    LikePlaylistDto,
    UnlikePlaylistDto,
    LikePlaylistResponse,
    UnlikePlaylistResponse,
    AddTrackToPlaylistDto,
    RemoveTrackFromPlaylistDto,
    CreatePlaylistDto,
    UpdatePlaylistDto,
} from "@/types/playlist.types";
import { PlaylistId, UserId } from "@/types/common.types";
import { ApiError } from "@/utils/error";
import { upsertInteractionComment } from "@/utils/interaction";
import { createNotification, buildNotificationPushContent } from "./notification.service";

/**
 * Retrieves playlists for a specific user.
 *
 * @param dto - Data transfer object containing userId, currentUserId, page, and limit.
 * @returns A promise that resolves to a paginated list of playlists.
 */
export const getUserPlaylists = async (dto: GetUserPlaylistsDto): Promise<GetUserPlaylistsResponse> => {
    const offset = (dto.page - 1) * dto.limit;
    const currentUserId = dto.currentUserId || null;
    const trackId = dto.trackId || null;

    const result = await pool.query<GetUserPlaylistsResponseItem>(playlistQueries.lists.getUserPlaylists, [
        dto.userId,
        currentUserId,
        dto.limit,
        offset,
        trackId,
    ]);

    return result.rows;
};

/**
 * Retrieves playlists liked by a specific user.
 *
 * @param dto - Data transfer object containing userId, currentUserId, page, and limit.
 * @returns A promise that resolves to a paginated list of liked playlists.
 */
export const getLikedPlaylists = async (dto: GetLikedPlaylistsDto): Promise<GetLikedPlaylistsResponse> => {
    const offset = (dto.page - 1) * dto.limit;
    const currentUserId = dto.currentUserId || null;

    const result = await pool.query<GetLikedPlaylistsResponseItem>(playlistQueries.likes.get, [
        dto.userId,
        currentUserId,
        dto.limit,
        offset,
    ]);

    return result.rows;
};

/**
 * Retrieves tracks/items within a specific playlist.
 *
 * @param dto - Data transfer object containing playlistId, currentUserId, page, and limit.
 * @returns A promise that resolves to a list of playlist track items.
 */
export const getPlaylistItems = async (dto: GetPlaylistItemsDto): Promise<GetPlaylistItemsResponse> => {
    const { playlistId, currentUserId = null, page, limit } = dto;
    const offset = (page - 1) * limit;

    const accessResult = await pool.query<{ id: string; hasAccess: boolean }>(playlistQueries.items.checkAccess, [
        playlistId,
        currentUserId,
    ]);

    if (accessResult.rows.length === 0) {
        throw new ApiError("NOT_FOUND", 404);
    }

    if (!accessResult.rows[0].hasAccess) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }

    const itemsResult = await pool.query<PlaylistItemResponseItem>(playlistQueries.items.getTracks, [
        playlistId,
        currentUserId,
        limit,
        offset,
    ]);

    return itemsResult.rows;
};

/**
 * Adds a specific track to a custom playlist.
 *
 * @param dto - Data transfer object containing the playlist ID, track ID, and user ID.
 * @returns The newly created PlaylistItem record representing the added track.
 * @throws {ApiError} 404 Not Found if the playlist does not exist, the track already exists in the list, or the user does not have permission to modify it.
 */
export const addTrackToPlaylist = async (dto: AddTrackToPlaylistDto) => {
    const { playlistId, trackId, userId } = dto;

    const result = await pool.query(playlistQueries.items.addTrack, [playlistId, trackId, userId]);
    const addedItem = result.rows[0];

    if (!addedItem) {
        throw new ApiError("ACTION_FAILED_NO_PERMISSION", 404);
    }

    return addedItem;
};

/**
 * Removes a specific track from a custom playlist.
 *
 * @param dto - Data transfer object containing the playlist ID, track ID, and user ID.
 * @returns void
 * @throws {ApiError} 404 Not Found if the playlist does not exist, the track is not in the list, or the user does not have permission to modify it.
 */
export const removeTrackFromPlaylist = async (dto: RemoveTrackFromPlaylistDto): Promise<void> => {
    const { playlistId, trackId, userId } = dto;

    const result = await pool.query(playlistQueries.items.removeTrack, [playlistId, trackId, userId]);

    if (result.rows.length === 0) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }
};

/**
 * Retrieves details for a specific playlist.
 *
 * @param dto - Data transfer object containing playlistId and optional currentUserId.
 * @returns A promise that resolves to playlist details.
 */
export const getPlaylistDetails = async (dto: GetPlaylistDetailsDto): Promise<GetPlaylistDetailsResponse> => {
    const { playlistId, currentUserId = null } = dto;

    const result = await pool.query<GetPlaylistDetailsResponse>(playlistQueries.getById, [playlistId, currentUserId]);

    const playlist = result.rows[0];

    if (!playlist) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }

    return playlist;
};

/**
 * Retrieves all interactions/comments for a specific playlist.
 *
 * @param dto - Data transfer object containing playlistId, page, and limit.
 * @returns A promise that resolves to a list of interactions with comments.
 */
export const getPlaylistInteractions = async (dto: GetPlaylistInteractionsDto) => {
    const { playlistId, currentUserId, page, limit } = dto;
    const offset = (page - 1) * limit;

    const result = await pool.query(playlistQueries.items.getInteractions, [playlistId, limit, offset, currentUserId || null]);

    return result.rows;
};

/**
 * Upserts a user interaction (rating, comment, isLiked) for a playlist.
 *
 * @param dto - Data transfer object containing userId, playlistId, rating, comment, isLiked.
 * @returns A promise that resolves to the saved interaction details.
 */
export const upsertPlaylistInteraction = async (dto: UpsertPlaylistInteractionDto) => {
    const { userId, playlistId, rating, comment, isLiked } = dto;
    const ratingVal = typeof rating === "number" && rating >= 0 ? rating : null;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const accessResult = await client.query<{ id: string; hasAccess: boolean }>(playlistQueries.items.checkAccess, [
            playlistId,
            userId,
        ]);

        if (accessResult.rows.length === 0 || !accessResult.rows[0].hasAccess) {
            throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
        }

        const interactionResult = await client.query(playlistQueries.interaction.upsert, [
            userId,
            playlistId,
            ratingVal,
            isLiked ?? false,
        ]);
        const interaction = interactionResult.rows[0];

        const commentData = await upsertInteractionComment(client, interaction.id, userId, comment);

        await client.query(playlistQueries.interaction.cleanupEmpty, [interaction.id]);

        await client.query("COMMIT");

        return {
            id: interaction.id,
            playlistId,
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

/**
 * Likes a playlist for the authenticated user.
 *
 * @param dto - Data transfer object containing userId and playlistId.
 * @returns An object containing playlistId and isLiked status.
 */
export const likePlaylist = async (dto: LikePlaylistDto): Promise<LikePlaylistResponse> => {
    const { userId, playlistId } = dto;

    const accessResult = await pool.query<{ id: string; hasAccess: boolean }>(playlistQueries.items.checkAccess, [
        playlistId,
        userId,
    ]);

    if (accessResult.rows.length === 0 || !accessResult.rows[0].hasAccess) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }

    const result = await pool.query<LikePlaylistResponse>(playlistQueries.likes.add, [userId, playlistId]);

    // Send notification to playlist creator (if not liking own playlist)
    const playlistRes = await pool.query<{ creatorId: string; title: string }>(
        `SELECT "creatorId", "title" FROM "Playlist" WHERE id = $1`,
        [playlistId],
    );
    if (playlistRes.rows.length > 0) {
        const playlist = playlistRes.rows[0];
        if (playlist.creatorId !== userId) {
            const userRes = await pool.query<{ username: string; fullname: string }>(
                `SELECT username, fullname FROM "User" WHERE id = $1`,
                [userId],
            );
            const liker = userRes.rows[0];
            const likerName = liker?.fullname || liker?.username;

            await createNotification({
                recipientId: playlist.creatorId,
                actorId: userId,
                type: "like",
                targetType: "playlist",
                targetId: playlistId,
                resolvePushContent: (locale) =>
                    buildNotificationPushContent(
                        "like",
                        {
                            actorName: likerName,
                            targetType: "playlist",
                            targetTitle: playlist.title,
                        },
                        locale,
                    ),
                path: `/playlists/${playlistId}`,
            });
        }
    }

    return result.rows[0];
};

/**
 * Unlikes a playlist for the authenticated user.
 *
 * @param dto - Data transfer object containing userId and playlistId.
 * @returns An object containing playlistId and isLiked status.
 */
export const unlikePlaylist = async (dto: UnlikePlaylistDto): Promise<UnlikePlaylistResponse> => {
    const { userId, playlistId } = dto;

    const accessResult = await pool.query<{ id: string; hasAccess: boolean }>(playlistQueries.items.checkAccess, [
        playlistId,
        userId,
    ]);

    if (accessResult.rows.length === 0 || !accessResult.rows[0].hasAccess) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }

    const result = await pool.query<UnlikePlaylistResponse>(playlistQueries.likes.remove, [userId, playlistId]);

    // Clean up unread notification
    await pool.query(
        `DELETE FROM "Notification"
         WHERE "actorId" = $1 AND "type" = 'like' AND "targetType" = 'playlist' AND "targetId" = $2 AND "isRead" = false`,
        [userId, playlistId],
    );

    return result.rows[0] || { playlistId, isLiked: false };
};

/**
 * Creates a new custom playlist for a user.
 *
 * @param dto - Data transfer object containing title, description, image, isPrivate, and creatorId.
 * @returns A promise that resolves to the newly created playlist.
 */
export const createPlaylist = async (dto: CreatePlaylistDto) => {
    const { title, description = null, image = null, isPrivate = false, creatorId } = dto;

    const result = await pool.query(playlistQueries.lists.create, [
        title,
        description,
        image,
        isPrivate,
        creatorId,
    ]);

    return result.rows[0];
};

/**
 * Updates an existing custom playlist.
 *
 * @param dto - Data transfer object containing playlist ID, user ID, and update fields.
 * @returns A promise that resolves to the updated playlist.
 */
export const updatePlaylist = async (dto: UpdatePlaylistDto) => {
    const { playlistId, userId, title, description, image, isPrivate } = dto;

    const result = await pool.query(playlistQueries.lists.update, [
        title ?? null,
        description !== undefined ? description : null,
        image !== undefined ? image : null,
        isPrivate ?? null,
        playlistId,
        userId,
        image !== undefined,
        description !== undefined,
    ]);

    const updatedPlaylist = result.rows[0];

    if (!updatedPlaylist) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }

    return updatedPlaylist;
};

/**
 * Deletes a custom playlist if the authenticated user is the creator.
 *
 * @param dto - Data transfer object containing playlist ID and user ID.
 */
export const deletePlaylist = async (dto: { playlistId: PlaylistId; userId: UserId }): Promise<void> => {
    const { playlistId, userId } = dto;

    const result = await pool.query(playlistQueries.lists.delete, [playlistId, userId]);
    const deletedPlaylist = result.rows[0];

    if (!deletedPlaylist) {
        throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
    }
};


