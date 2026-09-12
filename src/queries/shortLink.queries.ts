export const shortLinkQueries = {
    findByTarget: `
        SELECT code, target_type AS "targetType", target_id AS "targetId", created_at AS "createdAt"
        FROM short_links
        WHERE target_type = $1 AND target_id = $2
        LIMIT 1;
    `,
    findByCode: `
        SELECT code, target_type AS "targetType", target_id AS "targetId", created_at AS "createdAt"
        FROM short_links
        WHERE code = $1
        LIMIT 1;
    `,
    create: `
        INSERT INTO short_links (code, target_type, target_id)
        VALUES ($1, $2, $3)
        RETURNING code, target_type AS "targetType", target_id AS "targetId", created_at AS "createdAt";
    `,
};
