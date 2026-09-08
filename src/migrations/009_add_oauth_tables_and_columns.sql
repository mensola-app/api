ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "OAuthAccount" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "provider" VARCHAR(50) NOT NULL,
    "providerAccountId" VARCHAR(255) NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP,
    "token_type" VARCHAR(50),
    "scope" TEXT,
    "id_token" TEXT,
    "createdAt" TIMESTAMP DEFAULT NOW(),
    "updatedAt" TIMESTAMP DEFAULT NOW(),
    CONSTRAINT "uq_oauth_provider_account" UNIQUE ("provider", "providerAccountId")
);

CREATE INDEX IF NOT EXISTS "idx_oauth_accounts_provider_search" 
ON "OAuthAccount" ("provider", "providerAccountId");

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS set_updated_at_oauth_account ON "OAuthAccount";
CREATE TRIGGER set_updated_at_oauth_account
    BEFORE UPDATE ON "OAuthAccount"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();