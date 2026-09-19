-- Migration: 016_remove_reset_token_from_user.sql
-- Description: Drop resetToken and resetTokenExpires columns from User table as OTP and reset tickets are now managed in Redis.

ALTER TABLE "User"
    DROP COLUMN IF EXISTS "resetToken",
    DROP COLUMN IF EXISTS "resetTokenExpires";
