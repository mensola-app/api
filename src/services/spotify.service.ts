import { SpotifyId } from "@/types/common.types";
import { IAlbum, IArtist, ITrack } from "@/types/music.types";
import { GetNewAlbumsResult, ISpotifyArtist, ISpotifyTrack, SearchTrackResult } from "@/types/spotify.types";

import { getCache, setCache } from "@/utils/cache";

const SPOTIFY_TOKEN_CACHE_KEY = "spotify:client_token";

// In-memory fallback in case Redis is temporarily unreachable
let inMemorySpotifyToken = "";
let inMemoryTokenExpiresAt = 0;

/**
 * Retrieves a valid Spotify Client Credentials access token.
 * Checks Redis first; if missing, requests a fresh token from Spotify API,
 * caches it in Redis with safety TTL margin, and updates in-memory fallback.
 */
const getAccessToken = async (): Promise<string> => {
    // 1. Try to get token from Redis
    const cachedToken = await getCache<string>(SPOTIFY_TOKEN_CACHE_KEY);
    if (cachedToken) {
        return cachedToken;
    }

    // 2. Check in-memory fallback if Redis was empty/unavailable
    const now = Date.now();
    if (inMemorySpotifyToken && now < inMemoryTokenExpiresAt) {
        return inMemorySpotifyToken;
    }

    // 3. Request new token from Spotify
    const credentials = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString(
        "base64",
    );

    const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch Spotify access token: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.access_token) {
        throw new Error("Spotify response did not contain access_token");
    }

    // Apply safety margin (e.g. 5 minutes before actual expiry)
    const ttlSeconds = Math.max((data.expires_in || 3600) - 300, 60);

    // Save to Redis and update in-memory fallback
    await setCache(SPOTIFY_TOKEN_CACHE_KEY, data.access_token, ttlSeconds);
    inMemorySpotifyToken = data.access_token;
    inMemoryTokenExpiresAt = now + ttlSeconds * 1000;

    return data.access_token;
};

const getAlbumCover = (images?: Array<{ url: string; height: number; width: number }>) => {
    if (!images || images.length === 0) return undefined;

    const mediumImage = images[1] || images[0];
    return mediumImage.url;
};

export const spotifyService = {
    searchTracks: async (query: string, page: number = 1, limit: number = 10) => {
        const offset = (page - 1) * limit;
        const token = await getAccessToken();

        const res = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}&offset=${offset}`,
            { headers: { Authorization: `Bearer ${token}` } },
        );

        const searchData = await res.json();
        const searchDataTracks = searchData.tracks as SearchTrackResult;

        const tracks: Omit<ITrack, "id">[] = searchDataTracks.items.map((item) => {
            let album: Omit<IAlbum, "id"> | undefined;
            if (item.album) {
                album = {
                    spotifyId: item.album.id,
                    title: item.album.name,
                };
            }

            let artists: Omit<IArtist, "id">[] | undefined;
            if (item.artists) {
                artists = item.artists.map((itemArtist) => {
                    const artist: Omit<IArtist, "id"> = {
                        spotifyId: itemArtist.id,
                        name: itemArtist.name,
                    };

                    return artist;
                });
            }

            const track: Omit<ITrack, "id"> & { album?: Omit<IAlbum, "id">; artists?: Omit<IArtist, "id">[] } = {
                spotifyId: item.id,
                title: item.name,
                duration: item.duration_ms,
                image: getAlbumCover(item.album?.images),
                album: album,
                artists: artists,
            };

            return track;
        });

        const hasMore = offset + tracks.length < searchDataTracks.total;
        const totalResults = searchDataTracks.total;

        return { items: tracks, page, limit, hasMore, totalResults };
    },

    getNewAlbums: async (page: number, limit: number) => {
        const offset = (page - 1) * limit;
        const token = await getAccessToken();

        const res = await fetch(
            `https://api.spotify.com/v1/search?q=tag:new&type=album&market=TR&limit=${limit}&offset=${offset}`,
            { headers: { Authorization: `Bearer ${token}` } },
        );

        const spotifyData = await res.json();
        const newAlbums = spotifyData.albums as GetNewAlbumsResult;

        const albums: Omit<IAlbum, "id">[] = newAlbums.items.map((item) => {
            let artists: Omit<IArtist, "id">[] | undefined;
            if (item.artists) {
                artists = item.artists.map((itemArtist) => {
                    const artist: Omit<IArtist, "id"> = {
                        spotifyId: itemArtist.id,
                        name: itemArtist.name,
                    };

                    return artist;
                });
            }

            const album: Omit<IAlbum, "id"> & { artists?: Omit<IArtist, "id">[] } = {
                spotifyId: item.id,
                title: item.name,
                image: getAlbumCover(item.images),
                songCount: item.total_tracks,
                artists: artists,
            };

            return album;
        });

        const hasMore = offset + albums.length < newAlbums.total;
        const totalResults = newAlbums.total;

        return { items: albums, page, limit, hasMore, totalResults };
    },

    getTrackBySpotifyId: async (spotifyId: SpotifyId) => {
        const token = await getAccessToken();

        const res = await fetch(`https://api.spotify.com/v1/tracks/${spotifyId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        const spotifyData = (await res.json()) as ISpotifyTrack;

        let album: (Omit<IAlbum, "id"> & { artists?: Omit<IArtist, "id">[] }) | undefined;
        if (spotifyData.album) {
            album = {
                spotifyId: spotifyData.album.id,
                title: spotifyData.album.name,
                image: getAlbumCover(spotifyData.album?.images),
                releaseDate: spotifyData.album.release_date,
                songCount: spotifyData.album.total_tracks,
                artists: spotifyData.album.artists?.map((itemArtist: ISpotifyArtist) => {
                    const artist: Omit<IArtist, "id"> = {
                        spotifyId: itemArtist.id,
                        name: itemArtist.name,
                    };

                    return artist;
                }),
            };
        }

        let artists: Omit<IArtist, "id">[] | undefined;
        if (spotifyData.artists) {
            artists = spotifyData.artists.map((itemArtist: ISpotifyArtist) => {
                const artist: Omit<IArtist, "id"> = {
                    spotifyId: itemArtist.id,
                    name: itemArtist.name,
                };

                return artist;
            });
        }

        const track: Omit<ITrack, "id"> & {
            album?: Omit<IAlbum, "id"> & { artists?: Omit<IArtist, "id">[] };
            artists?: Omit<IArtist, "id">[];
        } = {
            spotifyId: spotifyData.id,
            title: spotifyData.name,
            duration: spotifyData.duration_ms,
            image: getAlbumCover(spotifyData.album?.images),
            album: album,
            artists: artists,
        };

        return track;
    },

    /**
     * Returns 10 new tracks from Spotify search (year:2026).
     * Used by the /v1/home newTracks section.
     */
    getNewTracks: async (limit: number = 10) => {
        const token = await getAccessToken();

        const res = await fetch(`https://api.spotify.com/v1/search?q=year:2026&type=track&limit=${limit}&market=US`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) throw new Error(`Spotify getNewTracks failed: ${res.status}`);

        const data = await res.json();
        const items: any[] = data.tracks?.items ?? [];

        return items.map((track: any) => {
            const cover = getAlbumCover(track.album?.images);
            return {
                spotifyId: track.id as SpotifyId,
                title: track.name,
                artistName: track.artists?.map((a: any) => a.name).join(", ") ?? "Unknown Artist",
                albumCoverUrl: cover,
                previewUrl: track.preview_url ?? null,
            };
        });
    },

    getAlbumBySpotifyId: async (spotifyId: SpotifyId) => {
        const token = await getAccessToken();

        const res = await fetch(`https://api.spotify.com/v1/albums/${spotifyId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) throw new Error(`Spotify getAlbumBySpotifyId failed: ${res.status}`);

        const spotifyData = await res.json();

        let artists: Omit<IArtist, "id">[] = [];
        if (spotifyData.artists) {
            artists = spotifyData.artists.map((itemArtist: ISpotifyArtist) => ({
                spotifyId: itemArtist.id,
                name: itemArtist.name,
            }));
        }

        return {
            spotifyId: spotifyData.id as SpotifyId,
            title: spotifyData.name,
            image: getAlbumCover(spotifyData.images),
            releaseDate: spotifyData.release_date,
            songCount: spotifyData.total_tracks,
            artists,
            tracks: (spotifyData.tracks?.items ?? []).map((t: any) => ({
                spotifyId: t.id as SpotifyId,
                title: t.name,
                duration: t.duration_ms,
                image: getAlbumCover(spotifyData.images),
                artists: t.artists?.map((a: any) => ({
                    spotifyId: a.id,
                    name: a.name,
                })) ?? [],
            })),
        };
    },
};
