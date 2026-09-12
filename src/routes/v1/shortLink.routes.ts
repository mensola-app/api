import { createShortLink, getShortLink, redirectShortLink } from "@/controllers/v1/shortLink.controller";
import { validate } from "@/middlewares/validate.middleware";
import { createShortLinkSchema, getShortLinkSchema } from "@/validations/shortLink.validation";
import { Router } from "express";

const router = Router();

router.post("/", validate(createShortLinkSchema), createShortLink);
router.get("/:code/redirect", validate(getShortLinkSchema), redirectShortLink);
router.get("/:code", validate(getShortLinkSchema), getShortLink);

export default router;
