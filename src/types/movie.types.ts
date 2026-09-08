import { IUser, UserSummary } from "@/types/user.types";
import { IInteraction, IComment } from "@/types/interaction.types";
import {
    UserId,
    CommentId,
    InteractionId,
    MovieId,
    TmdbId,
    MovieListId,
    WatchedMovieId,
    PaginationQueries,
} from "@/types/common.types";

// ==========================================
// Core Entities & Relational Models
// ==========================================

export interface IMovie {
    id: MovieId;
    tmdbId: TmdbId;
    title: string;
    poster: URL | string;
    releaseDate?: Date | string;
    rating?: number;
    genres?: string[];
    duration?: number;
    overview?: string;
    createdAt?: Date | string;
}

export type MovieListType = "custom" | "favorites" | "watchlist";

export interface IMovieList {
    id: MovieListId;
    title: string;
    description?: string;
    image?: string;
    isPrivate: boolean;
    listType?: MovieListType;
    creatorId: UserId;
    createdAt?: Date | string;
    updatedAt?: Date | string;
}

export interface IMovieListItem {
    movieListId: MovieListId;
    movieId: MovieId;
    addedBy: UserId;
    addedAt?: Date | string;
}

export interface IMovieListOwner {
    movieListId: MovieListId;
    userId: UserId;
}

export interface IWatchedMovie {
    id: WatchedMovieId;
    userId: UserId;
    movieId: MovieId;
    watchedAt: Date | string;
}

// ==========================================
// DTOs & Payloads
// ==========================================

export type BaseUserQueryDto = PaginationQueries & { userId?: UserId };
export type GetFavoritesDto = BaseUserQueryDto;
export type GetWatchlistDto = BaseUserQueryDto;
export type GetWatchedMoviesDto = BaseUserQueryDto;
export type GetLikedMoviesDto = BaseUserQueryDto;
export type GetUserListsDto = BaseUserQueryDto & { currentUserId?: UserId; movieId?: MovieId };
export type GetLikedListsDto = BaseUserQueryDto & { currentUserId?: UserId };
export type CreateMovieListDto = Omit<IMovieList, "id">;
export type UserMovieActionDto = { userId: UserId; movieId: MovieId };
export type GetMovieDto = { movieId: MovieId; currentUserId?: UserId };
export type UseMovieListKeyDto = { userId: UserId; listId: MovieListId };
export type UpdateMovieListDto = Omit<IMovieList, "id" | "creatorId" | "listType"> & UseMovieListKeyDto;
export type DeleteListDto = UseMovieListKeyDto;
export type LikeMovieListDto = UseMovieListKeyDto;
export type UnlikeMovieListDto = UseMovieListKeyDto;
export type GetListByIdDto = { listId: MovieListId; userId?: UserId };
export type GetListItemsDto = GetListByIdDto & PaginationQueries;
export type MovieListItemDto = { listId: MovieListId; movieId: MovieId; userId: UserId };
export type LikeMovieDto = UserMovieActionDto;
export type UnlikeMovieDto = UserMovieActionDto;
export type FindOrFetchFromTmdbDto = { tmdbId: TmdbId; userId?: UserId };

// ==========================================
// API Responses & Nested Projections
// ==========================================

export type MovieSummary = Pick<IMovie, "id" | "title" | "poster">;
export type MovieResponseItem = MovieSummary & {
    rating?: number;
    isLiked?: boolean;
    hasReview?: boolean;
    addedAt?: Date | string;
};
export type GetFavoritesResponseItem = MovieResponseItem;
export type GetLikedMoviesResponseItem = MovieResponseItem;
export type GetFavoritesResponse = GetFavoritesResponseItem[];
export type GetLikedMoviesResponse = GetLikedMoviesResponseItem[];
export type GetWatchlistResponse = MovieSummary[];
export type GetWatchedMoviesResponseItem = MovieSummary & {
    rating?: number;
    isLiked?: boolean;
    hasReview?: boolean;
    watchedAt?: Date | string;
};
export type GetWatchedMoviesResponse = GetWatchedMoviesResponseItem[];
export type PreviewMoviesItem = MovieSummary & { rating?: number; isLiked?: boolean };
export type MovieListResponseItem = {
    listId: MovieListId;
    listTitle: IMovieList["title"];
    image?: string | null;
    movieCount?: number;
    creator?: Pick<IUser, "id" | "username" | "avatar">;
    containsMovie?: boolean;
    previewMovies: PreviewMoviesItem[];
};
export type GetUserListsResponseItem = MovieListResponseItem;
export type GetLikedListsResponseItem = MovieListResponseItem;
export type GetUserListsResponse = GetUserListsResponseItem[];
export type GetLikedListsResponse = GetLikedListsResponseItem[];
export type GetMovieInteractionsItem = Pick<IInteraction, "id" | "isLiked" | "rating"> & {
    user: Pick<IUser, "id" | "username" | "fullname" | "avatar">;
    comment: Pick<IComment, "id" | "content"> & { date: IComment["createdAt"] };
};
export type GetMovieResponse = IMovie & {
    isWatched?: boolean;
    isInList?: boolean;
    isWatchlisted?: boolean;
    isFavorite?: boolean;
    likesCount?: number;
    commentsCount?: number;
    interactions: GetMovieInteractionsItem[];
    currentUserInteraction: Omit<GetMovieInteractionsItem, "user">;
};
export type MovieListLatestCommentItem = {
    commentId: CommentId;
    content: string;
    date: Date | string;
    interactionId: InteractionId;
    rating: number | null;
    isLiked: boolean;
    user: UserSummary;
};
export type GetListByIdResponse = IMovieList & {
    owners: (UserSummary & {
        isFollowing?: boolean;
        isFollower?: boolean;
    })[];
    isSaved?: boolean;
    savesCount?: number;
};
export type GetListItemsResponse = MovieResponseItem[];
export type LikeMovieListResult = { listId: MovieListId; isLiked: boolean };
export type LikeMovieListResponse = LikeMovieListResult;
export type UnlikeMovieListResponse = LikeMovieListResult;
export type LikeMovieResult = { movieId: MovieId; isLiked: boolean };
export type LikeMovieResponse = LikeMovieResult;
export type UnlikeMovieResponse = LikeMovieResult;
