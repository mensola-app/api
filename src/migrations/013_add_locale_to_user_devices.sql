-- ======================================================
-- Migration 013: Add locale column to UserDevices table
-- ======================================================

ALTER TABLE "UserDevices" 
ADD COLUMN IF NOT EXISTS "locale" VARCHAR(10) DEFAULT 'tr';
