-- ======================================================
-- Migration 011: Create UserDevices table
-- ======================================================

CREATE TABLE IF NOT EXISTS "UserDevices" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "pushToken" TEXT NOT NULL,
    "platform" VARCHAR(50) NOT NULL,
    "updatedAt" TIMESTAMP DEFAULT NOW(),
    CONSTRAINT "uq_user_devices_push_token" UNIQUE ("pushToken")
);

CREATE INDEX IF NOT EXISTS "idx_user_devices_user_id" 
    ON "UserDevices" ("userId");

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS set_updated_at_user_devices ON "UserDevices";
CREATE TRIGGER set_updated_at_user_devices
    BEFORE UPDATE ON "UserDevices"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
