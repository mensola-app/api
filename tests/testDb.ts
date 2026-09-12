import { Pool } from "pg";

const pool = new Pool({
    host: process.env.POSTGRES_HOST || "test-db",
    user: process.env.POSTGRES_TEST_USER,
    password: process.env.POSTGRES_TEST_PASSWORD,
    database: process.env.POSTGRES_TEST_DB,
    port: Number(process.env.POSTGRES_PORT) || 5432
});

pool.on("connect", () => {
    console.log("The test database connection was successful");
});

export default pool;
