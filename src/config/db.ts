import { Pool } from "pg";

const pool = new Pool({
    host: process.env.POSTGRES_HOST || "db",
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    port: Number(process.env.POSTGRES_PORT) || 5432
});

pool.on("connect", () => {
    console.log("The database connection was successful");
});

pool.on("error", err => {
    console.error("Unexpected database error:", err);
    process.exit(-1);
});

export default pool;
