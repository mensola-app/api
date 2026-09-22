import crypto from "crypto";
import pool from "@/config/db";
import { getAccessToken, spotifyService } from "./spotify.service";
import {
    NormalizedSpotifyAlbum,
    NormalizedSpotifyArtist,
    NormalizedSpotifyPlaylist,
    NormalizedSpotifyTrack,
} from "@/types/import.types";
import { sanitizeHtml } from "./import.service";
import { invalidateUserProfile } from "@/utils/cache";
import { ApiError } from "@/utils/error";

const MAX_PLAYLIST_TRACKS = 5000;
const BATCH_SIZE = 100;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Splits an array into chunks of a given size.
 */
const chunkArray = <T>(arr: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
};

/**
 * Normalizes an individual track item from Spotify's playlist response.
 * Handles both item.track and item.item, filtering out local or null tracks.
 */
export const normalizeSpotifyTrack = (item: any): NormalizedSpotifyTrack | null => {
    if (!item || item.is_local === true) {
        return null;
    }

    const trackObj = item.track || item.item;
    if (!trackObj || trackObj.is_local === true || !trackObj.id) {
        return null;
    }

    const artists: NormalizedSpotifyArtist[] = (trackObj.artists || [])
        .filter((a: any) => a && a.id && a.name)
        .map((a: any) => ({
            spotifyId: String(a.id),
            name: String(a.name).trim().slice(0, 255),
        }));

    const albumArtists: NormalizedSpotifyArtist[] = (trackObj.album?.artists || [])
        .filter((a: any) => a && a.id && a.name)
        .map((a: any) => ({
            spotifyId: String(a.id),
            name: String(a.name).trim().slice(0, 255),
        }));

    const rawCover = trackObj.album?.images?.[0]?.url || null;

    const album: NormalizedSpotifyAlbum = {
        spotifyId: trackObj.album?.id || `fallback_${trackObj.id}`,
        title: String(trackObj.album?.name || trackObj.name || "Untitled Album").trim().slice(0, 255),
        releaseDate: trackObj.album?.release_date || null,
        coverUrl: rawCover,
        artists: albumArtists.length > 0 ? albumArtists : artists,
    };

    return {
        spotifyId: String(trackObj.id),
        title: String(trackObj.name || "Untitled Track").trim().slice(0, 255),
        durationMs: typeof trackObj.duration_ms === "number" ? Math.max(0, Math.floor(trackObj.duration_ms)) : 0,
        addedAt: item.added_at || null,
        artists,
        album,
    };
};

/**
 * Executes a GET request with automatic retry handling for HTTP 429 (Too Many Requests).
 */
const fetchWithRetry = async (url: string, token: string, retries = 3): Promise<Response> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
            },
        });

        if (res.status === 429) {
            const retryHeader = res.headers.get("Retry-After");
            const waitSeconds = retryHeader ? parseInt(retryHeader, 10) : 3;
            const waitMs = (!isNaN(waitSeconds) && waitSeconds > 0 ? waitSeconds : 3) * 1000;
            console.warn(`[SpotifyImport] Rate limited (429). Retrying after ${waitMs}ms...`);
            await sleep(waitMs);
            continue;
        }

        return res;
    }

    throw new Error(`Max retries exceeded for URL: ${url}`);
};

/**
 * Fetches public playlist metadata and tracks from Spotify's public embed page.
 * This is used when Spotify's official Web API restricts track retrieval under Client Credentials mode.
 */
export const fetchTracksFromEmbed = async (
    playlistId: string,
    fallbackName?: string,
    fallbackDescription?: string | null,
    fallbackCoverUrl?: string | null,
): Promise<NormalizedSpotifyPlaylist> => {
    const embedUrl = `https://open.spotify.com/embed/playlist/${encodeURIComponent(playlistId)}`;
    const res = await fetch(embedUrl, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    });

    if (!res.ok) {
        if (res.status === 404) {
            throw new ApiError("PLAYLIST_NOT_FOUND", 404, `Spotify playlist ${playlistId} not found or is private.`);
        }
        throw new Error(`Failed to fetch Spotify embed playlist: HTTP ${res.status}`);
    }

    const html = await res.text();
    let entity: any = null;

    // 1. Try __NEXT_DATA__
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
        try {
            const parsed = JSON.parse(nextDataMatch[1]);
            entity = parsed.props?.pageProps?.state?.data?.entity;
        } catch {}
    }

    // 2. Try initial-state
    if (!entity) {
        const initialStateMatch = html.match(/<script id="initial-state"[^>]*>([\s\S]*?)<\/script>/);
        if (initialStateMatch) {
            try {
                const content = initialStateMatch[1].trim();
                const decoded = content.startsWith("{")
                    ? content
                    : Buffer.from(content, "base64").toString("utf-8");
                const parsed = JSON.parse(decoded);
                entity = parsed.data?.entity || parsed.entity;
            } catch {}
        }
    }

    if (!entity) {
        throw new ApiError(
            "PLAYLIST_NOT_FOUND",
            404,
            `Could not parse track details for Spotify playlist ${playlistId}.`,
        );
    }

    const name = String(entity.title || entity.name || fallbackName || "Untitled Playlist")
        .trim()
        .slice(0, 255);
    const description = entity.subtitle
        ? String(entity.subtitle).slice(0, 500)
        : fallbackDescription || null;
    const coverUrl = entity.coverArt?.sources?.[0]?.url || fallbackCoverUrl || null;

    const rawTracks: any[] = Array.isArray(entity.trackList) ? entity.trackList : [];

    // Fetch individual track thumbnails safely without hitting rate limits
    const trackThumbnails = new Map<string, string>();
    const trackIdsToFetch = rawTracks
        .slice(0, MAX_PLAYLIST_TRACKS)
        .map((t) => (t.uri ? t.uri.replace("spotify:track:", "") : t.id))
        .filter(Boolean);

    // 1. Check existing track covers in DB to avoid redundant requests
    if (trackIdsToFetch.length > 0) {
        try {
            const existingTracks = await pool.query<{ spotifyId: string; image: string }>(
                `SELECT "spotifyId", "image" FROM "Track" WHERE "spotifyId" = ANY($1) AND "image" IS NOT NULL`,
                [trackIdsToFetch],
            );
            for (const row of existingTracks.rows) {
                trackThumbnails.set(row.spotifyId, row.image);
            }
        } catch {}
    }

    // 2. Fetch remaining tracks via oembed in gentle chunks of 5 with 60ms delay
    const missingIds = trackIdsToFetch.filter((id) => !trackThumbnails.has(id));
    for (const chunk of chunkArray(missingIds, 5)) {
        await Promise.all(
            chunk.map(async (id) => {
                try {
                    const oembedRes = await fetch(
                        `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${id}`,
                    );
                    if (oembedRes.ok) {
                        const oembedData = await oembedRes.json();
                        if (oembedData?.thumbnail_url) {
                            // Upgrade 300x300 to 640x640 high-res cover
                            const highRes = oembedData.thumbnail_url.replace(
                                "ab67616d00001e02",
                                "ab67616d0000b273",
                            );
                            trackThumbnails.set(id, highRes);
                        }
                    }
                } catch {}
            }),
        );
        if (missingIds.length > 5) {
            await sleep(60);
        }
    }

    const allTracks: NormalizedSpotifyTrack[] = [];
    for (const item of rawTracks.slice(0, MAX_PLAYLIST_TRACKS)) {
        const trackId = item.uri ? item.uri.replace("spotify:track:", "") : item.id;
        if (!trackId) continue;

        const title = String(item.title || item.name || "Untitled Track")
            .trim()
            .slice(0, 255);
        const durationMs =
            typeof item.duration === "number" ? Math.max(0, Math.floor(item.duration)) : 0;
        // Real track album cover (never fall back to playlist cover)
        const trackCover = trackThumbnails.get(trackId) || item.coverArt?.sources?.[0]?.url || null;

        let artists: NormalizedSpotifyArtist[] = [];
        if (Array.isArray(item.artists) && item.artists.length > 0) {
            artists = item.artists
                .filter((a: any) => a && (a.name || a.title))
                .map((a: any) => {
                    const artName = String(a.name || a.title).trim().slice(0, 255);
                    const artId = a.uri
                        ? a.uri.replace("spotify:artist:", "")
                        : `art_${crypto.createHash("md5").update(artName.toLowerCase()).digest("hex").slice(0, 24)}`;
                    return { spotifyId: artId, name: artName };
                });
        } else if (item.subtitle) {
            const names = String(item.subtitle).split(/,\s*|\s*&\s*/).filter(Boolean);
            artists = names.map((n) => {
                const artName = n.trim().slice(0, 255);
                const artId = `art_${crypto.createHash("md5").update(artName.toLowerCase()).digest("hex").slice(0, 24)}`;
                return { spotifyId: artId, name: artName };
            });
        }

        if (artists.length === 0) {
            artists = [{ spotifyId: "art_unknown", name: "Unknown Artist" }];
        }

        allTracks.push({
            spotifyId: trackId,
            title,
            durationMs,
            addedAt: item.added_at || null,
            artists,
            album: {
                spotifyId: `alb_${trackId}`,
                title,
                coverUrl: trackCover,
                releaseDate: item.releaseDate?.isoString || null,
                artists,
            },
        });
    }

    return {
        spotifyId: String(entity.id || playlistId),
        name,
        description,
        coverUrl,
        totalTracks: allTracks.length,
        tracks: allTracks,
    };
};

export const spotifyImportService = {
    /**
     * Fetches playlist metadata and all tracks.
     * Tries the official Spotify Web API first. If tracks are omitted (due to Client Credentials restrictions)
     * or the request fails/is forbidden, seamlessly falls back to extracting tracks from Spotify embed.
     */
    fetchSpotifyPlaylist: async (playlistId: string): Promise<NormalizedSpotifyPlaylist> => {
        let playlistName = "Untitled Playlist";
        let playlistDescription: string | null = null;
        let playlistCoverUrl: string | null = null;
        const allTracks: NormalizedSpotifyTrack[] = [];
        const seenTrackIds = new Set<string>();
        let totalTracks = 0;

        try {
            const token = await getAccessToken();
            const initialUrl = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}`;
            const initialRes = await fetchWithRetry(initialUrl, token);

            if (initialRes.ok) {
                const data = await initialRes.json();
                playlistName = String(data.name || "Untitled Playlist").trim().slice(0, 255);
                playlistDescription = data.description ? sanitizeHtml(String(data.description)).slice(0, 500) : null;
                playlistCoverUrl = data.images?.[0]?.url || null;

                const container = data.tracks || data.items;
                totalTracks = container?.total ?? 0;

                // Step 1: Process first batch already present in initial response
                if (container?.items && Array.isArray(container.items)) {
                    for (const item of container.items) {
                        const norm = normalizeSpotifyTrack(item);
                        if (norm && !seenTrackIds.has(norm.spotifyId)) {
                            seenTrackIds.add(norm.spotifyId);
                            allTracks.push(norm);
                        }
                    }
                }

                // Step 2: Paginate through next pages if available
                let nextUrl: string | null = container?.next || null;
                while (nextUrl && allTracks.length < MAX_PLAYLIST_TRACKS) {
                    await sleep(100);
                    const pageRes = await fetchWithRetry(nextUrl, token);
                    if (!pageRes.ok) break;

                    const pageData = await pageRes.json();
                    const pageItems: any[] = pageData.items || [];
                    for (const item of pageItems) {
                        if (allTracks.length >= MAX_PLAYLIST_TRACKS) break;
                        const norm = normalizeSpotifyTrack(item);
                        if (norm && !seenTrackIds.has(norm.spotifyId)) {
                            seenTrackIds.add(norm.spotifyId);
                            allTracks.push(norm);
                        }
                    }

                    nextUrl = pageData.next || null;
                }
            }
        } catch (apiErr) {
            console.warn(`[SpotifyImport] Official Web API failed for playlist ${playlistId}, falling back to embed parser.`, apiErr);
        }

        // If official Web API returned 0 tracks (common under Client Credentials mode), extract from embed
        if (allTracks.length === 0) {
            console.log(`[SpotifyImport] No tracks from official Web API for playlist ${playlistId}, extracting from Spotify embed...`);
            return await fetchTracksFromEmbed(playlistId, playlistName, playlistDescription, playlistCoverUrl);
        }

        return {
            spotifyId: playlistId,
            name: playlistName,
            description: playlistDescription,
            coverUrl: playlistCoverUrl,
            totalTracks: totalTracks || allTracks.length,
            tracks: allTracks,
        };
    },

    /**
     * Persists playlist metadata, albums, artists, tracks, and playlist items into the Mensola database.
     * Uses 100-item chunk batch upserts for maximum throughput and low connection pool overhead.
     * Preserves playlist ordering deterministically by staggering addedAt timestamps.
     */
    persistSpotifyPlaylist: async (
        userId: string,
        playlistData: NormalizedSpotifyPlaylist,
    ): Promise<{ playlistId: string; tracksCount: number }> => {
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // 1. Create Playlist record
            const playlistInsertRes = await client.query<{ id: string }>(
                `INSERT INTO "Playlist" (id, title, description, image, "isPrivate", "creatorId", "listType", "createdAt", "updatedAt")
                 VALUES (gen_random_uuid(), $1, $2, $3, false, $4, 'custom', NOW(), NOW())
                 RETURNING id`,
                [playlistData.name, playlistData.description, playlistData.coverUrl, userId],
            );
            const playlistId = playlistInsertRes.rows[0].id;

            // Also insert into PlaylistOwner
            await client.query(
                `INSERT INTO "PlaylistOwner" ("playlistId", "userId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [playlistId, userId],
            );

            // 2. Collect unique artists across all tracks and albums
            const artistMap = new Map<string, NormalizedSpotifyArtist>();
            for (const track of playlistData.tracks) {
                for (const a of track.artists) {
                    if (a.spotifyId && a.name && !artistMap.has(a.spotifyId)) {
                        artistMap.set(a.spotifyId, a);
                    }
                }
                for (const a of track.album.artists || []) {
                    if (a.spotifyId && a.name && !artistMap.has(a.spotifyId)) {
                        artistMap.set(a.spotifyId, a);
                    }
                }
            }

            // Reuse existing artist from DB if matched by name (0 external requests)
            for (const [key, artist] of Array.from(artistMap.entries())) {
                if (artist.spotifyId.startsWith("art_")) {
                    try {
                        const dbMatch = await client.query<{ id: string; spotifyId: string; image: string | null }>(
                            `SELECT id, "spotifyId", image FROM "Artist" WHERE LOWER(name) = LOWER($1) LIMIT 1`,
                            [artist.name],
                        );
                        if (dbMatch.rows.length > 0) {
                            const found = dbMatch.rows[0];
                            const oldId = artist.spotifyId;
                            artist.spotifyId = found.spotifyId;
                            artist.image = artist.image || found.image;
                            artistMap.delete(oldId);
                            artistMap.set(found.spotifyId, artist);
                            for (const trk of playlistData.tracks) {
                                for (const a of trk.artists) {
                                    if (a.spotifyId === oldId) a.spotifyId = found.spotifyId;
                                }
                                for (const a of trk.album.artists || []) {
                                    if (a.spotifyId === oldId) a.spotifyId = found.spotifyId;
                                }
                            }
                        }
                    } catch (dbErr) {
                        console.warn(`[SpotifyImport] DB artist lookup failed for "${artist.name}":`, dbErr);
                    }
                }
            }

            // Batch Upsert Artists in chunks of 100
            const artistIdMap = new Map<string, string>(); // spotifyId -> UUID
            const artistList = Array.from(artistMap.values());
            for (const chunk of chunkArray(artistList, BATCH_SIZE)) {
                const values: any[] = [];
                const valuePlaceholders: string[] = [];

                chunk.forEach((artist, idx) => {
                    const offset = idx * 3;
                    valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, NOW())`);
                    values.push(artist.spotifyId, artist.name, artist.image || null);
                });

                const query = `
                    INSERT INTO "Artist" ("spotifyId", "name", "image", "createdAt")
                    VALUES ${valuePlaceholders.join(", ")}
                    ON CONFLICT ("spotifyId") DO UPDATE
                    SET "name" = EXCLUDED."name",
                        "image" = COALESCE("Artist"."image", EXCLUDED."image")
                    RETURNING "id", "spotifyId";
                `;

                const res = await client.query<{ id: string; spotifyId: string }>(query, values);
                for (const row of res.rows) {
                    artistIdMap.set(row.spotifyId, row.id);
                }
            }

            // 3. Collect unique albums across all tracks
            const albumMap = new Map<string, NormalizedSpotifyAlbum>();
            for (const track of playlistData.tracks) {
                if (track.album.spotifyId && !albumMap.has(track.album.spotifyId)) {
                    albumMap.set(track.album.spotifyId, track.album);
                }
            }

            // Batch Upsert Albums in chunks of 100
            const albumIdMap = new Map<string, string>(); // spotifyId -> UUID
            const albumList = Array.from(albumMap.values());
            for (const chunk of chunkArray(albumList, BATCH_SIZE)) {
                const values: any[] = [];
                const valuePlaceholders: string[] = [];

                chunk.forEach((album, idx) => {
                    const offset = idx * 4;
                    valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, NOW())`);
                    values.push(album.spotifyId, album.title, album.coverUrl, album.releaseDate);
                });

                const query = `
                    INSERT INTO "Album" ("spotifyId", "title", "image", "releaseDate", "createdAt")
                    VALUES ${valuePlaceholders.join(", ")}
                    ON CONFLICT ("spotifyId") DO UPDATE
                    SET "title" = EXCLUDED."title",
                        "image" = COALESCE(EXCLUDED."image", "Album"."image"),
                        "releaseDate" = COALESCE(EXCLUDED."releaseDate", "Album"."releaseDate")
                    RETURNING "id", "spotifyId";
                `;

                const res = await client.query<{ id: string; spotifyId: string }>(query, values);
                for (const row of res.rows) {
                    albumIdMap.set(row.spotifyId, row.id);
                }
            }

            // Batch link AlbumArtists in chunks of 100
            const albumArtistPairs: Array<{ albumId: string; artistId: string }> = [];
            for (const album of albumList) {
                const albUuid = albumIdMap.get(album.spotifyId);
                if (!albUuid) continue;
                for (const a of album.artists || []) {
                    const artUuid = artistIdMap.get(a.spotifyId);
                    if (artUuid) {
                        albumArtistPairs.push({ albumId: albUuid, artistId: artUuid });
                    }
                }
            }

            for (const chunk of chunkArray(albumArtistPairs, BATCH_SIZE)) {
                const values: any[] = [];
                const valuePlaceholders: string[] = [];

                chunk.forEach((pair, idx) => {
                    const offset = idx * 2;
                    valuePlaceholders.push(`($${offset + 1}, $${offset + 2})`);
                    values.push(pair.albumId, pair.artistId);
                });

                const query = `
                    INSERT INTO "AlbumArtist" ("albumId", "artistId")
                    VALUES ${valuePlaceholders.join(", ")}
                    ON CONFLICT ("albumId", "artistId") DO NOTHING;
                `;

                await client.query(query, values);
            }

            // 4. Batch Upsert Tracks in chunks of 100
            const trackIdMap = new Map<string, string>(); // spotifyId -> UUID
            for (const chunk of chunkArray(playlistData.tracks, BATCH_SIZE)) {
                const values: any[] = [];
                const valuePlaceholders: string[] = [];

                chunk.forEach((track, idx) => {
                    const offset = idx * 5;
                    const albUuid = albumIdMap.get(track.album.spotifyId) || null;
                    valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, NOW())`);
                    values.push(track.spotifyId, track.title, track.durationMs, track.album.coverUrl, albUuid);
                });

                const query = `
                    INSERT INTO "Track" ("spotifyId", "title", "duration", "image", "albumId", "createdAt")
                    VALUES ${valuePlaceholders.join(", ")}
                    ON CONFLICT ("spotifyId") DO UPDATE
                    SET "title" = EXCLUDED."title",
                        "duration" = EXCLUDED."duration",
                        "image" = COALESCE(EXCLUDED."image", "Track"."image"),
                        "albumId" = COALESCE(EXCLUDED."albumId", "Track"."albumId")
                    RETURNING "id", "spotifyId";
                `;

                const res = await client.query<{ id: string; spotifyId: string }>(query, values);
                for (const row of res.rows) {
                    trackIdMap.set(row.spotifyId, row.id);
                }
            }

            // Batch link TrackArtists in chunks of 100
            const trackArtistPairs: Array<{ trackId: string; artistId: string }> = [];
            for (const track of playlistData.tracks) {
                const trkUuid = trackIdMap.get(track.spotifyId);
                if (!trkUuid) continue;
                for (const a of track.artists) {
                    const artUuid = artistIdMap.get(a.spotifyId);
                    if (artUuid) {
                        trackArtistPairs.push({ trackId: trkUuid, artistId: artUuid });
                    }
                }
            }

            for (const chunk of chunkArray(trackArtistPairs, BATCH_SIZE)) {
                const values: any[] = [];
                const valuePlaceholders: string[] = [];

                chunk.forEach((pair, idx) => {
                    const offset = idx * 2;
                    valuePlaceholders.push(`($${offset + 1}, $${offset + 2})`);
                    values.push(pair.trackId, pair.artistId);
                });

                const query = `
                    INSERT INTO "TrackArtist" ("trackId", "artistId")
                    VALUES ${valuePlaceholders.join(", ")}
                    ON CONFLICT ("trackId", "artistId") DO NOTHING;
                `;

                await client.query(query, values);
            }

            // 5. Batch Insert PlaylistItems with sequence order preservation
            // Mensola queries playlist tracks with: ORDER BY pli."addedAt" DESC
            // Therefore, track 0 should have the largest timestamp: baseTime - index * 1000ms
            const baseTime = Date.now();
            const playlistItems: Array<{ trackId: string; addedAt: string }> = [];

            playlistData.tracks.forEach((track, idx) => {
                const trkUuid = trackIdMap.get(track.spotifyId);
                if (trkUuid) {
                    const itemAddedAt = new Date(baseTime - idx * 1000).toISOString();
                    playlistItems.push({ trackId: trkUuid, addedAt: itemAddedAt });
                }
            });

            for (const chunk of chunkArray(playlistItems, BATCH_SIZE)) {
                const values: any[] = [];
                const valuePlaceholders: string[] = [];

                chunk.forEach((item, idx) => {
                    const offset = idx * 4;
                    valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::TIMESTAMPTZ)`);
                    values.push(playlistId, item.trackId, userId, item.addedAt);
                });

                const query = `
                    INSERT INTO "PlaylistItem" ("playlistId", "trackId", "addedBy", "addedAt")
                    VALUES ${valuePlaceholders.join(", ")}
                    ON CONFLICT ("playlistId", "trackId") DO NOTHING;
                `;

                await client.query(query, values);
            }

            await client.query("COMMIT");

            // 6. Invalidate user profile cache so updated playlist counts reflect immediately
            await invalidateUserProfile(userId);

            return {
                playlistId,
                tracksCount: playlistItems.length,
            };
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    },
};
