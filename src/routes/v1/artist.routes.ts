import { Router } from "express";
import {
    followArtistHandler,
    unfollowArtistHandler,
    getArtistDetails,
    getArtistDiscographyHandler,
} from "@/controllers/v1/artist.controller";
import { extractUser, verifyToken } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import {
    artistFollowParamSchema,
    artistIdParamSchema,
    artistDiscographyQuerySchema,
} from "@/validations/artist.validation";

const router = Router();

router.post("/:id/follow", verifyToken, validate(artistFollowParamSchema), followArtistHandler);
router.delete("/:id/follow", verifyToken, validate(artistFollowParamSchema), unfollowArtistHandler);
router.get("/:id/discography", extractUser, validate(artistDiscographyQuerySchema), getArtistDiscographyHandler);
router.get("/:id/albums", extractUser, validate(artistDiscographyQuerySchema), getArtistDiscographyHandler);
router.get("/:id", extractUser, validate(artistIdParamSchema), getArtistDetails);

export default router;

