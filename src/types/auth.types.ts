import { IUser } from "@/types/user.types";

// ==========================================
// DTOs & Payloads
// ==========================================

export type CreateUserDto = Pick<IUser, "username" | "email"> & { password: string };
export type LoginUserDto = Pick<IUser, "email"> & { password: string };
export type TokenRefreshDto = { refreshToken: string };
export type LogoutDto = { refreshToken: string };
export type SendResetEmailDto = Pick<IUser, "email">;
export type VerifyCodeDto = Pick<IUser, "email"> & { code: string };
export type UpdatePasswordDto = { ticket: string; newPassword: string };

// ==========================================
// Auth API Responses
// ==========================================

export interface CreateUserResponse {
    user: IUser;
    accessToken: string;
    refreshToken: string;
}
export interface LoginUserResponse {
    user: IUser;
    accessToken: string;
    refreshToken: string;
}
export type TokenRefreshResponse = { accessToken: string };
export type VerifyCodeResponse = { ticket: string };

// ==========================================
// Google OAuth
// ==========================================

export type GoogleAuthDto = { idToken: string };
export interface GoogleAuthResponse {
    user: IUser;
    accessToken: string;
    refreshToken: string;
}
