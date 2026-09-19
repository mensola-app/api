import pool from "@/config/db";
import { tmdbService } from "@/services/tmdb.service";
import { spotifyService } from "@/services/spotify.service";
import { HomeResponseData, HeroMovie, NowPlayingMovie, NewTrack } from "@/types/home.types";
import { UserId } from "@/types/common.types";
import { getOrSetCache, deleteCache } from "@/utils/cache";

interface PublicHomeFeed {
    heroMovies: HeroMovie[];
    nowPlayingMovies: NowPlayingMovie[];
    newTracks: NewTrack[];
}

const HOME_FEED_CACHE_KEY = "home:feed";
const HOME_FEED_TTL_SECONDS = 30 * 60; // 30 minutes

/**
 * Fetches public home feed data from TMDB and Spotify in parallel.
 * Uses Promise.allSettled so a single source failure returns partial results
 * instead of rejecting the entire response.
 */
const fetchPublicHomeFeed = async (): Promise<PublicHomeFeed> => {
    const [heroResult, nowPlayingResult, newTracksResult] = await Promise.allSettled([
        tmdbService.getTrendingHero(5),
        tmdbService.getNowPlaying(15),
        spotifyService.getNewTracks(10),
    ]);

    return {
        heroMovies: heroResult.status === "fulfilled" ? heroResult.value : [],
        nowPlayingMovies: nowPlayingResult.status === "fulfilled" ? nowPlayingResult.value : [],
        newTracks: newTracksResult.status === "fulfilled" ? newTracksResult.value : [],
    };
};

/**
 * Aggregates home screen data by retrieving cached public feed (or fetching from TMDB/Spotify)
 * and checking for user-specific pending follow requests in parallel.
 */
export const getHomeData = async (viewerId?: UserId): Promise<HomeResponseData> => {
    const pendingFollowPromise = viewerId
        ? pool.query<{ hasPending: boolean }>(
              `SELECT EXISTS (
                  SELECT 1 FROM "Follow"
                  WHERE "followingId" = $1 AND "status" = 'pending'
              ) AS "hasPending"`,
              [viewerId],
          )
        : Promise.resolve(null);

    const [feedResult, pendingFollowResult] = await Promise.allSettled([
        getOrSetCache<PublicHomeFeed>(HOME_FEED_CACHE_KEY, HOME_FEED_TTL_SECONDS, fetchPublicHomeFeed),
        pendingFollowPromise,
    ]);

    const feed: PublicHomeFeed =
        feedResult.status === "fulfilled" && feedResult.value
            ? feedResult.value
            : { heroMovies: [], nowPlayingMovies: [], newTracks: [] };

    const hasPendingFollowRequest =
        pendingFollowResult.status === "fulfilled" &&
        pendingFollowResult.value !== null &&
        Boolean(pendingFollowResult.value.rows[0]?.hasPending);

    return {
        heroMovies: feed.heroMovies,
        nowPlayingMovies: feed.nowPlayingMovies,
        newTracks: feed.newTracks,
        hasPendingFollowRequest,
    };
};

/**
 * Invalidates the cached home feed.
 */
export const invalidateHomeFeedCache = async (): Promise<void> => {
    await deleteCache(HOME_FEED_CACHE_KEY);
};

