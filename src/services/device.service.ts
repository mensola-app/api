import pool from "@/config/db";
import { deviceQueries } from "@/queries/device.queries";
import { RegisterDeviceDto, UpdateDeviceLocaleDto, DeviceResponse } from "@/types/device.types";
import { UserId } from "@/types/common.types";
import { ApiError } from "@/utils/error";

/**
 * Registers or updates a device push token, locale and platform for a user.
 * Overwrites ownership if the token previously belonged to another user.
 *
 * @param userId - Authenticated user ID
 * @param dto - Device registration data (pushToken, locale, optional platform)
 * @returns Object containing the device ID in the database
 */
export const registerDevice = async (
    userId: UserId | string,
    dto: RegisterDeviceDto,
): Promise<DeviceResponse> => {
    const result = await pool.query<{ id: string }>(deviceQueries.upsert, [
        userId,
        dto.pushToken,
        dto.locale || "tr",
        dto.platform || "unknown",
    ]);

    return result.rows[0];
};

/**
 * Updates the locale preference for a specific registered device.
 * Enforces ownership check against authenticated user ID.
 *
 * @param userId - Authenticated user ID
 * @param deviceId - Device record UUID
 * @param dto - Contains the new locale string
 * @returns Updated device info
 */
export const updateDeviceLocale = async (
    userId: UserId | string,
    deviceId: string,
    dto: UpdateDeviceLocaleDto,
): Promise<DeviceResponse> => {
    const result = await pool.query<{ id: string; locale: string }>(deviceQueries.updateLocale, [
        dto.locale,
        deviceId,
        userId,
    ]);

    if (result.rowCount === 0) {
        throw new ApiError("NOT_FOUND", 404, "Device not found or permission denied");
    }

    return result.rows[0];
};

/**
 * Deletes a device registration record upon logout.
 * Enforces ownership check against authenticated user ID.
 *
 * @param userId - Authenticated user ID
 * @param deviceId - Device record UUID
 */
export const deleteDevice = async (
    userId: UserId | string,
    deviceId: string,
): Promise<{ success: boolean }> => {
    const result = await pool.query(deviceQueries.deleteById, [deviceId, userId]);

    if (result.rowCount === 0) {
        throw new ApiError("NOT_FOUND", 404, "Device not found or permission denied");
    }

    return { success: true };
};
