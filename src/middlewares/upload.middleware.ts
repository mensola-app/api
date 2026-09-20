import { Request } from "express";
import { ApiError } from "@/utils/error";
import multer from "multer";

const imageFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (file.mimetype.startsWith("image/")) {
        cb(null, true);
    } else {
        cb(new ApiError("INVALID_FILE_TYPE") as any, false);
    }
};

export const avatarUploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter,
}).single("avatar");

export const coverUploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: imageFilter,
}).single("cover");

const zipFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (file.mimetype === "application/zip" || file.mimetype === "application/x-zip-compressed") {
        cb(null, true);
    } else {
        cb(new ApiError("INVALID_FILE_TYPE") as any, false);
    }
};

export const zipUploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: zipFilter,
}).single("zip");
