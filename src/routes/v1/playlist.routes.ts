import { Router } from "express";

import {
    getUserPlaylistsList,
    getLikedPlaylistsList,
    getPlaylistItemsList,
    getPlaylistById,
    getPlaylistInteractionsList,
    createPlaylistInteraction,
    likePlaylist,
    unlikePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    createPlaylistHandler,
    updatePlaylistHandler,
    deletePlaylistHandler,
} from "@/controllers/v1/playlist.controller";

import { extractUser, verifyToken } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";

import {
    playlistPaginationQuerySchema,
    playlistIdParamSchema,
    createPlaylistInteractionSchema,
    addTrackToPlaylistSchema,
    createPlaylistSchema,
    updatePlaylistSchema,
} from "@/validations/playlist.validation";
import { requiredUserId } from "@/middlewares/requiredId.middleware";

const router = Router();

router.post("/", verifyToken, validate(createPlaylistSchema), createPlaylistHandler);
router.patch("/:playlistId", verifyToken, validate(updatePlaylistSchema), updatePlaylistHandler);
router.delete("/:playlistId", verifyToken, validate(playlistIdParamSchema), deletePlaylistHandler);
router.post("/:playlistId/items/:trackId", verifyToken, validate(addTrackToPlaylistSchema), addTrackToPlaylist);
router.delete("/:playlistId/items/:trackId", verifyToken, validate(addTrackToPlaylistSchema), removeTrackFromPlaylist);

router.get("/likes", extractUser, validate(playlistPaginationQuerySchema), requiredUserId, getLikedPlaylistsList);
router.get("/:playlistId/items", extractUser, validate(playlistIdParamSchema), getPlaylistItemsList);
router.get("/:playlistId/interactions", extractUser, validate(playlistIdParamSchema), getPlaylistInteractionsList);
router.post(
    "/:playlistId/interactions",
    verifyToken,
    validate(createPlaylistInteractionSchema),
    createPlaylistInteraction,
);
router.post("/:playlistId/like", verifyToken, validate(playlistIdParamSchema), likePlaylist);
router.delete("/:playlistId/like", verifyToken, validate(playlistIdParamSchema), unlikePlaylist);
router.get("/:playlistId", extractUser, validate(playlistIdParamSchema), getPlaylistById);
router.get("/", extractUser, validate(playlistPaginationQuerySchema), requiredUserId, getUserPlaylistsList);

export default router;
