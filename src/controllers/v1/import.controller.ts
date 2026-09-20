import { Request, Response, NextFunction } from "express";
import { sendResponse } from "@/utils/response";
import { ApiError } from "@/utils/error";
import { importService } from "@/services/import.service";

/**
 * Handles Letterboxd ZIP export upload, validates, parses, queues BullMQ job,
 * and immediately responds with 202 Accepted.
 */
export const importLetterboxd = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        if (!req.file) {
            throw new ApiError("NO_FILE_UPLOADED", 400);
        }

        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError("UNAUTHORIZED", 401);
        }

        const { items } = importService.validateAndParseZip(req.file.buffer);
        const job = await importService.createImportJob(userId, items);

        sendResponse(res, 202, job, "IMPORT_QUEUED");
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves current progress of a specific import job.
 */
export const getImportProgress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { jobId } = req.params as { jobId: string };
        const userId = req.user?.id;

        if (!userId) {
            throw new ApiError("UNAUTHORIZED", 401);
        }

        const progress = await importService.getJobProgress(jobId);
        if (!progress) {
            throw new ApiError("NOT_FOUND", 404);
        }

        if (progress.userId !== userId) {
            throw new ApiError("NOT_FOUND_OR_NO_PERMISSION", 404);
        }

        sendResponse(res, 200, progress, "RETRIEVED_SUCCESSFULLY");
    } catch (error) {
        next(error);
    }
};
