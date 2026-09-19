import pool from "@/config/db";
import crypto from "crypto";
import { MovieListType } from "@/types/movie.types";

/**
 * Creates a mock movie directly in the database for testing.
 */
export const createTestMovie = async (overrides = {}) => {
    const movie = {
        id: crypto.randomUUID(),
        tmdbId: crypto.randomUUID(),
        title: "Test Movie",
        poster: "https://example.com/test-poster.jpg",
        ...overrides,
    };

    const query = `
        INSERT INTO "Movie" (id, "tmdbId", "title", "poster") 
        VALUES ($1, $2, $3, $4) RETURNING *;
    `;

    const result = await pool.query(query, [movie.id, movie.tmdbId, movie.title, movie.poster]);

    return result.rows[0];
};

export const addTestMovieToWatched = async (userId: string, movieId: string) => {
    const id = crypto.randomUUID();

    const watchedMovie = { id, userId, movieId, watchedAt: new Date() };

    const query = `
        INSERT INTO "WatchedMovie" (id, "userId", "movieId", "watchedAt")
        VALUES ($1, $2, $3, $4) RETURNING *;`;

    const values = [id, userId, movieId, watchedMovie.watchedAt];

    const result = await pool.query(query, values);

    return result.rows[0];
};

export const createTestMovieList = async (creatorId: string, listType?: MovieListType, overrides = {}) => {
    const id = crypto.randomUUID();

    const movieList = {
        id,
        title: "Test Movie List",
        isPrivate: false,
        listType: listType || "custom",
        creatorId,
        ...overrides,
    };

    const query = `
        INSERT INTO "MovieList" (id, title, "isPrivate", "listType", "creatorId")
        VALUES ($1, $2, $3, $4, $5) RETURNING *;`;

    const values = [id, movieList.title, movieList.isPrivate, movieList.listType, movieList.creatorId];

    const result = await pool.query(query, values);

    return result.rows[0];
};

export const addTestMovieToList = async (userId: string, movieId: string, listId: string) => {
    const query = `
        INSERT INTO "MovieListItem" ("movieListId", "movieId", "addedBy")
        VALUES ($1, $2, $3) RETURNING *;`;

    const values = [listId, movieId, userId];

    const result = await pool.query(query, values);
    return result.rows[0];
};

export const addTestMovieToLikes = async (userId: string, movieId: string) => {
    const id = crypto.randomUUID();

    const query = `
        INSERT INTO "Interaction" ("userId", "targetId", "targetType", "isLiked")
        VALUES ($1, $2, 'movie', true) RETURNING *;`;

    const values = [userId, movieId];

    const result = await pool.query(query, values);
    return result.rows[0];
};

export const addTestListToLikes = async (userId: string, listId: string) => {
    const id = crypto.randomUUID();

    const query = `
        INSERT INTO "Interaction" ("userId", "targetId", "targetType", "isLiked")
        VALUES ($1, $2, 'movieList', true) RETURNING *;`;

    const values = [userId, listId];

    const result = await pool.query(query, values);
    return result.rows[0];
};

export interface ICreateTestInteractionOptions {
    isLiked?: boolean;
    rating?: number | null;
    comment?: string | null;
    targetType?: "movie" | "movieList" | "track" | "playlist" | "album";
}

export const createTestInteraction = async (
    userId: string,
    targetId: string,
    options: ICreateTestInteractionOptions = {},
) => {
    const { isLiked = false, rating = null, comment = null, targetType = "movie" } = options;

    const interactionQuery = `
    INSERT INTO "Interaction" ("userId", "targetId", "targetType", "isLiked", "rating")
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT ("userId", "targetId", "targetType") 
    DO UPDATE SET 
      "isLiked" = EXCLUDED."isLiked",
      "rating" = EXCLUDED."rating",
      "updatedAt" = NOW()
    RETURNING id, "userId", "targetId", "targetType", "isLiked", "rating";
  `;

    const interactionResult = await pool.query(interactionQuery, [userId, targetId, targetType, isLiked, rating]);

    const interaction = interactionResult.rows[0];
    let createdComment = null;

    if (comment) {
        const commentQuery = `
      INSERT INTO "Comment" ("interactionId", "userId", "content")
      VALUES ($1, $2, $3)
      RETURNING id, content, "createdAt";
    `;

        const commentResult = await pool.query(commentQuery, [interaction.id, userId, comment]);

        createdComment = commentResult.rows[0];
    }

    return {
        ...interaction,
        comment: createdComment,
    };
};

export const createTestBookmark = async (
    userId: string,
    targetId: string,
    targetType: "playlist" | "album" | "movieList" = "movieList",
) => {
    const query = `
    INSERT INTO "Bookmark" ("userId", "targetId", "targetType")
    VALUES ($1, $2, $3)
    ON CONFLICT ("userId", "targetId", "targetType") DO NOTHING
    RETURNING *;
  `;
    const result = await pool.query(query, [userId, targetId, targetType]);
    return result.rows[0];
};

export const createTestTrack = async (
    options: { title?: string; duration?: number; spotifyId?: string; albumId?: string } = {},
) => {
    const {
        title = "Test Track",
        duration = 200,
        spotifyId = `test_spotify_id_${Date.now()}_${Math.random()}`,
        albumId = null,
    } = options;

    const query = `
    INSERT INTO "Track" ("spotifyId", "title", "duration", "albumId")
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
    const result = await pool.query(query, [spotifyId, title, duration, albumId]);
    return result.rows[0];
};

export const createTestArtist = async (options: { name?: string; spotifyId?: string } = {}) => {
    const { name = "Test Artist", spotifyId = `test_artist_spotify_id_${Date.now()}_${Math.random()}` } = options;

    const query = `
    INSERT INTO "Artist" ("spotifyId", "name")
    VALUES ($1, $2)
    RETURNING *;
  `;
    const result = await pool.query(query, [spotifyId, name]);
    return result.rows[0];
};

export const createTestTrackArtist = async (trackId: string, artistId: string) => {
    const query = `
    INSERT INTO "TrackArtist" ("trackId", "artistId")
    VALUES ($1, $2)
    RETURNING *;
  `;
    const result = await pool.query(query, [trackId, artistId]);
    return result.rows[0];
};

export const createTestPlaylist = async (
    userId: string,
    options: { title?: string; isPrivate?: boolean; listType?: "custom" | "favorites" } = {},
) => {
    const { title = "Test Playlist", isPrivate = false, listType = "custom" } = options;

    const query = `
    INSERT INTO "Playlist" ("title", "creatorId", "isPrivate", "listType")
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
    const result = await pool.query(query, [title, userId, isPrivate, listType]);
    return result.rows[0];
};

export const createTestAlbum = async (
    options: { title?: string; spotifyId?: string; releaseDate?: string; songCount?: number } = {},
) => {
    const {
        title = "Test Album",
        spotifyId = `test_album_spotify_id_${Date.now()}_${Math.random()}`,
        releaseDate = "2024-01-01",
        songCount = 10,
    } = options;

    const query = `
        INSERT INTO "Album" ("spotifyId", "title", "releaseDate", "songCount")
        VALUES ($1, $2, $3, $4)
        RETURNING *;
    `;
    const result = await pool.query(query, [spotifyId, title, releaseDate, songCount]);
    return result.rows[0];
};

export const addTestTrackToPlaylist = async (playlistId: string, trackId: string, addedBy: string) => {
    const query = `
        INSERT INTO "PlaylistItem" ("playlistId", "trackId", "addedBy")
        VALUES ($1, $2, $3)
        RETURNING *;
    `;
    const result = await pool.query(query, [playlistId, trackId, addedBy]);
    return result.rows[0];
};

export const createTestArtistFollow = async (userId: string, artistId: string) => {
    const query = `
        INSERT INTO "ArtistFollow" ("userId", "artistId")
        VALUES ($1, $2)
        ON CONFLICT ("userId", "artistId") DO NOTHING
        RETURNING *;
    `;
    const result = await pool.query(query, [userId, artistId]);
    return result.rows[0];
};
