import { Request, Response, NextFunction } from "express";
import { registerDevice, updateDeviceLocale, deleteDevice } from "@/services/device.service";
import { RegisterDeviceDto, UpdateDeviceLocaleDto } from "@/types/device.types";
import { sendResponse } from "@/utils/response";
import { ApiError } from "@/utils/error";

export const registerDeviceController = async (
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError("UNAUTHORIZED", 401);
        }
        const dto: RegisterDeviceDto = req.body;
        const device = await registerDevice(userId, dto);

        sendResponse(res, 200, device, "Device registered successfully");
    } catch (error) {
        next(error);
    }
};

export const updateDeviceLocaleController = async (
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError("UNAUTHORIZED", 401);
        }
        const { id } = req.params;
        const dto: UpdateDeviceLocaleDto = req.body;

        const device = await updateDeviceLocale(userId, id as string, dto);

        sendResponse(res, 200, device, "Device locale updated successfully");
    } catch (error) {
        next(error);
    }
};

export const deleteDeviceController = async (
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            throw new ApiError("UNAUTHORIZED", 401);
        }
        const { id } = req.params;

        await deleteDevice(userId, id as string);

        sendResponse(res, 200, null, "Device removed successfully");
    } catch (error) {
        next(error);
    }
};
