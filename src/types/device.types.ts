import { UserId } from "./common.types";

export interface RegisterDeviceDto {
    pushToken: string;
    locale: string;
    platform?: string;
}

export interface UpdateDeviceLocaleDto {
    locale: string;
}

export interface DeviceResponse {
    id: string;
    locale?: string;
}
