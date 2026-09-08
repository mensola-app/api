import { Router } from "express";
import { verifyToken } from "@/middlewares/auth.middleware";
import { uploadAvatar, uploadCover } from "@/controllers/v1/storage.controller";
import { avatarUploadMiddleware, coverUploadMiddleware } from "@/middlewares/upload.middleware";

const router = Router();

router.post("/upload/avatar", verifyToken, avatarUploadMiddleware, uploadAvatar);
router.post("/upload/cover", verifyToken, coverUploadMiddleware, uploadCover);

export default router;

