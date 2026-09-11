-- ======================================================
-- Migration 012: Create Notification table
-- ======================================================

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "recipientId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "actorId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "type" VARCHAR(50) NOT NULL,
    "targetType" VARCHAR(50) NULL,
    "targetId" VARCHAR(255) NULL,
    "isRead" BOOLEAN DEFAULT FALSE,
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup index for unread notifications per user
CREATE INDEX IF NOT EXISTS "idx_notifications_recipient_read" 
    ON "Notification" ("recipientId", "isRead");

-- Fast ordering index for feed retrieval
CREATE INDEX IF NOT EXISTS "idx_notifications_recipient_created" 
    ON "Notification" ("recipientId", "createdAt" DESC);
