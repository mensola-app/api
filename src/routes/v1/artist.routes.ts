import { Router } from "express";
import { followArtistHandler, unfollowArtistHandler, getArtistDetails } from "@/controllers/v1/artist.controller";
import { extractUser, verifyToken } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { artistFollowParamSchema, artistIdParamSchema } from "@/validations/artist.validation";

const router = Router();

router.post("/:id/follow", verifyToken, validate(artistFollowParamSchema), followArtistHandler);
router.delete("/:id/follow", verifyToken, validate(artistFollowParamSchema), unfollowArtistHandler);
router.get("/:id", extractUser, validate(artistIdParamSchema), getArtistDetails);

export default router;
