import { ArtistSummary, IPlaylist, ITrack } from "@/types/music.types";
import { PaginationQueries, PlaylistId, TrackId, UserId } from "@/types/common.types";
import { CurrentUserInteraction } from "@/types/interaction.types";
import { UserSummary } from "@/types/user.types";

// ==========================================
// DTOs & Payloads
// ==========================================

export type GetUserPlaylistsDto = PaginationQueries & { userId: UserId; currentUserId?: UserId; trackId?: TrackId };
export type GetLikedPlaylistsDto = PaginationQueries & { userId: UserId; currentUserId?: UserId };
export type GetPlaylistItemsDto = PaginationQueries & { playlistId: PlaylistId; currentUserId?: UserId };
export type GetPlaylistDetailsDto = { playlistId: PlaylistId; currentUserId?: UserId };
export type GetPlaylistInteractionsDto = PaginationQueries & { playlistId: PlaylistId; currentUserId?: string };
export type UpsertPlaylistInteractionDto = {
    userId: UserId;
    playlistId: PlaylistId;
    rating?: number | null;
    comment?: string | null;
    isLiked?: boolean;
};
export type LikePlaylistDto = { userId: UserId; playlistId: PlaylistId };
export type UnlikePlaylistDto = LikePlaylistDto;
export type AddTrackToPlaylistDto = { playlistId: PlaylistId; trackId: TrackId; userId: UserId };
export type RemoveTrackFromPlaylistDto = AddTrackToPlaylistDto;
export type CreatePlaylistDto = {
    title: string;
    description?: string | null;
    image?: string | null;
    isPrivate?: boolean;
    creatorId: UserId;
};
export type UpdatePlaylistDto = {
    playlistId: PlaylistId;
    userId: UserId;
    title?: string;
    description?: string | null;
    image?: string | null;
    isPrivate?: boolean;
};


// ==========================================
// API Responses
// ==========================================

export type GetUserPlaylistsResponseItem = IPlaylist & { songCount?: number; containsTrack?: boolean };
export type GetUserPlaylistsResponse = GetUserPlaylistsResponseItem[];
export type GetLikedPlaylistsResponseItem = IPlaylist & { songCount?: number; creator?: UserSummary };
export type GetLikedPlaylistsResponse = GetLikedPlaylistsResponseItem[];
export type PlaylistItemResponseItem = Omit<ITrack, "albumId" | "createdAt"> & {
    addedAt?: Date | string;
    isLiked?: boolean;
    addedBy?: UserSummary;
    artists?: ArtistSummary[];
};
export type GetPlaylistItemsResponse = PlaylistItemResponseItem[];
export type GetPlaylistDetailsResponse = IPlaylist & {
    songCount: number;
    creator: UserSummary;
    owners: UserSummary[];
    isSaved: boolean;
    savesCount: number;
    isLiked: boolean;
    likesCount: number;
    currentUserInteraction?: CurrentUserInteraction;
};
export type LikePlaylistResponse = { playlistId: PlaylistId; isLiked: boolean };
export type UnlikePlaylistResponse = LikePlaylistResponse;
