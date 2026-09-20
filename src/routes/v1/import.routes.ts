import { Router } from "express";
import multer from "multer";
import { verifyToken } from "@/middlewares/auth.middleware";
import { importLetterboxd, getImportProgress } from "@/controllers/v1/import.controller";
import { ApiError } from "@/utils/error";

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max
    },
    fileFilter: (_req, file, cb) => {
        const isZip =
            file.originalname.toLowerCase().endsWith(".zip") ||
            file.mimetype === "application/zip" ||
            file.mimetype === "application/x-zip-compressed" ||
            file.mimetype === "application/octet-stream";

        if (isZip) {
            cb(null, true);
        } else {
            cb(new ApiError("INVALID_ZIP_FILE", 400));
        }
    },
});

router.post("/letterboxd", verifyToken, upload.single("file"), importLetterboxd);
router.get("/:jobId", verifyToken, getImportProgress);

export default router;
