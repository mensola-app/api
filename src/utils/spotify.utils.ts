import { ApiError } from "./error";

const SPOTIFY_ID_REGEX = /^[a-zA-Z0-9]{22}$/;

/**
 * Extracts the 22-character alphanumeric Spotify playlist ID from various formats:
 * - https://open.spotify.com/playlist/5XzIwoEzc7KWg250ua37Ew?si=...
 * - https://open.spotify.com/intl-tr/playlist/5XzIwoEzc7KWg250ua37Ew?si=...
 * - spotify:playlist:5XzIwoEzc7KWg250ua37Ew
 * - 5XzIwoEzc7KWg250ua37Ew (raw 22-character ID)
 *
 * Gracefully rejects non-playlist Spotify URLs (e.g. tracks, albums, artists).
 */
export const parseSpotifyPlaylistId = (input: string): string => {
    if (!input || typeof input !== "string") {
        throw new ApiError("INVALID_SPOTIFY_PLAYLIST_URL", 400);
    }

    const trimmed = input.trim();

    // Explicitly detect and reject non-playlist Spotify entities
    const nonPlaylistPatterns = [
        /(?:open\.spotify\.com\/(?:intl-[a-z]{2}\/)?|spotify:)(track|album|artist|show|episode)[/:]([a-zA-Z0-9]+)/i,
    ];

    for (const pattern of nonPlaylistPatterns) {
        const match = trimmed.match(pattern);
        if (match) {
            const entityType = match[1].toLowerCase();
            throw new ApiError(
                "INPUT_IS_NOT_A_PLAYLIST",
                400,
                `The provided link is for a Spotify ${entityType}, not a playlist. Only Spotify playlists can be imported.`,
            );
        }
    }

    // 1. Raw 22-character ID
    if (SPOTIFY_ID_REGEX.test(trimmed)) {
        return trimmed;
    }

    // 2. Spotify URI format: spotify:playlist:5XzIwoEzc7KWg250ua37Ew
    const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]{22})$/i);
    if (uriMatch) {
        return uriMatch[1];
    }

    // 3. Web URL format: https://open.spotify.com/[intl-xx/]playlist/5XzIwoEzc7KWg250ua37Ew(?si=...)
    try {
        // Parse URL to cleanly strip query params and hash
        const parsedUrl = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
        const pathParts = parsedUrl.pathname.split("/").filter(Boolean);

        // Find index of 'playlist' segment in the path
        const playlistIndex = pathParts.findIndex((part) => part.toLowerCase() === "playlist");
        if (playlistIndex !== -1 && pathParts[playlistIndex + 1]) {
            const candidateId = pathParts[playlistIndex + 1];
            if (SPOTIFY_ID_REGEX.test(candidateId)) {
                return candidateId;
            }
        }
    } catch {
        // Fall back to regex if URL parsing fails
        const urlMatch = trimmed.match(/playlist\/([a-zA-Z0-9]{22})/i);
        if (urlMatch) {
            return urlMatch[1];
        }
    }

    throw new ApiError("INVALID_SPOTIFY_PLAYLIST_URL", 400, "Could not extract a valid Spotify playlist ID.");
};
