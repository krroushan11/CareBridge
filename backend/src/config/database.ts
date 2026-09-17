import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Connectivity check: pool.query borrows and releases a client, whereas
// pool.connect() would keep a client checked out for the process lifetime and
// prevent pool.end() (used by the test suites) from ever completing.
pool.query("SELECT 1")
  .then(() => console.log("🚀 PostgreSQL Connected Successfully"))
  .catch((error) => console.error("Database Connection Error:", error));