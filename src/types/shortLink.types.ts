export type ShortLinkTargetType = "movie_list" | "playlist" | "user";

export interface ShortLink {
    code: string;
    targetType: ShortLinkTargetType;
    targetId: string;
    createdAt: string;
}

export interface CreateShortLinkDto {
    targetType: ShortLinkTargetType;
    targetId: string;
}

export interface ShortLinkResponse {
    targetType: ShortLinkTargetType;
    targetId: string;
}
