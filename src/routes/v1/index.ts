import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import movieRoutes from "./movie.routes";
import bookmarkRoutes from "./bookmark.routes";
import trackRoutes from "./track.routes";
import playlistRoutes from "./playlist.routes";
import albumRoutes from "./album.routes";
import tmdbRoutes from "./tmdb.routes";
import spotifyRoutes from "./spotify.routes";
import storageRoutes from "./storage.routes";
import betaRoutes from "./beta.routes";
import homeRoutes from "./home.routes";
import notificationRoutes from "./notification.routes";
import commentRoutes from "./comment.routes";
import deviceRoutes from "./device.routes";

import { Router } from "express";

const v1Router = Router();

v1Router.use("/auth", authRoutes);
v1Router.use("/users", userRoutes);
v1Router.use("/user", userRoutes);
v1Router.use("/movies", movieRoutes);
v1Router.use("/bookmarks", bookmarkRoutes);
v1Router.use("/tracks", trackRoutes);
v1Router.use("/playlists", playlistRoutes);
v1Router.use("/albums", albumRoutes);
v1Router.use("/tmdb", tmdbRoutes);
v1Router.use("/spotify", spotifyRoutes);
v1Router.use("/storage", storageRoutes);
v1Router.use("/beta", betaRoutes);
v1Router.use("/home", homeRoutes);
v1Router.use("/notifications", notificationRoutes);
v1Router.use("/comments", commentRoutes);
v1Router.use("/devices", deviceRoutes);

export default v1Router;
