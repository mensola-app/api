import { Router } from "express";
import {
    registerDeviceController,
    updateDeviceLocaleController,
    deleteDeviceController,
} from "@/controllers/v1/device.controller";
import { verifyToken } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import {
    registerDeviceSchema,
    updateDeviceLocaleSchema,
    deviceIdParamSchema,
} from "@/validations/device.validation";

const router = Router();

/**
 * @route   POST /v1/devices
 * @desc    Register or update device push token and locale (upsert)
 * @access  Private
 */
router.post("/", verifyToken, validate(registerDeviceSchema), registerDeviceController);

/**
 * @route   PATCH /v1/devices/:id
 * @desc    Update device locale preference
 * @access  Private
 */
router.patch("/:id", verifyToken, validate(updateDeviceLocaleSchema), updateDeviceLocaleController);

/**
 * @route   DELETE /v1/devices/:id
 * @desc    Remove device registration on logout
 * @access  Private
 */
router.delete("/:id", verifyToken, validate(deviceIdParamSchema), deleteDeviceController);

export default router;
