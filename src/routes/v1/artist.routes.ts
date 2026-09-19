import { Router } from "express";
import { followArtistHandler, unfollowArtistHandler } from "@/controllers/v1/artist.controller";
import { verifyToken } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { artistFollowParamSchema } from "@/validations/artist.validation";

const router = Router();

router.post("/:id/follow", verifyToken, validate(artistFollowParamSchema), followArtistHandler);
router.delete("/:id/follow", verifyToken, validate(artistFollowParamSchema), unfollowArtistHandler);

export default router;
