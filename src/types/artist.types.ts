export interface ArtistFollow {
    id: string;
    userId: string;
    artistId: string; // Spotify ID
    createdAt: string;
}

export interface ToggleArtistFollowResult {
    artistId: string;
    isFollowing: boolean;
}
