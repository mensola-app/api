export const authQueries = {
    /**
     * Database queries for the User entity
     */
    user: {
        create: `
            INSERT INTO "User" (id, email, username, password, "createdAt", "updatedAt") 
            VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) 
            RETURNING id, email, username;`,
        findByEmail: `
            SELECT *
            FROM "User" WHERE email = $1`,
        findIdByEmail: `SELECT id FROM "User" WHERE email = $1 AND "deletedAt" IS NULL`,
        reactivate: `
            UPDATE "User"
            SET "deletedAt" = NULL, "updatedAt" = NOW()
            WHERE id = $1;
        `,
        // Updates user password and timestamps
        updatePassword: `UPDATE "User" SET password = $1, "updatedAt" = NOW() WHERE id = $2`,
    },

    /**
     * Database queries for Session and Refresh Token management
     */
    session: {
        create: `INSERT INTO "Session" ("userId", "refreshToken") VALUES ($1, $2)`,
        getByToken: `SELECT * FROM "Session" WHERE "refreshToken" = $1`,
        deleteByToken: `DELETE FROM "Session" WHERE "refreshToken" = $1`,
        deleteByUserId: `DELETE FROM "Session" WHERE "userId" = $1`,
    },

    /**
     * Database queries for OAuth account management
     */
    oauth: {
        findByProvider: `
            SELECT "userId"
            FROM "OAuthAccount"
            WHERE "provider" = $1 AND "providerAccountId" = $2`,
        createAccount: `
            INSERT INTO "OAuthAccount" ("id", "userId", "provider", "providerAccountId", "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())`,
        createUserWithOAuth: `
            INSERT INTO "User" (id, email, username, fullname, avatar, "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
            RETURNING id, email, username, fullname, avatar`,
        findUserByEmail: `
            SELECT id FROM "User" WHERE email = $1`,
        findUserById: `
            SELECT id, email, username, fullname, avatar FROM "User" WHERE id = $1`,
        isUsernameTaken: `
            SELECT 1 FROM "User" WHERE username = $1 LIMIT 1`,
        findProvidersByUserId: `
            SELECT provider FROM "OAuthAccount" WHERE "userId" = $1`,
    },
} as const;
