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

// Response type for GET /v1/artists/:id
export interface ArtistDetailResponse {
    id: string;          // Internal DB UUID
    spotifyId: string;
    name: string;
    image?: string;
    genres?: string[];
    spotifyFollowers?: number;
    followerCount: number;
    isFollowing: boolean;
    topTracks: ArtistTopTrack[];
}

export interface ArtistTopTrack {
    spotifyId: string;
    title: string;
    duration: number;
    image?: string;
    artists: { spotifyId: string; name: string }[];
    album?: { spotifyId: string; title: string; image?: string };
}
