export const deviceQueries = {
    upsert: `
        INSERT INTO "UserDevices" ("userId", "pushToken", "locale", "platform", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT ("pushToken") 
        DO UPDATE SET 
            "userId" = EXCLUDED."userId",
            "locale" = EXCLUDED."locale",
            "platform" = COALESCE(EXCLUDED."platform", "UserDevices"."platform"),
            "updatedAt" = NOW()
        RETURNING id;
    `,

    updateLocale: `
        UPDATE "UserDevices"
        SET "locale" = $1, "updatedAt" = NOW()
        WHERE id = $2 AND "userId" = $3
        RETURNING id, "locale";
    `,

    deleteById: `
        DELETE FROM "UserDevices"
        WHERE id = $1 AND "userId" = $2
        RETURNING id;
    `,
};
