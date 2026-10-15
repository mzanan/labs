import { Pool } from "pg";

let pool: Pool | null = null;

export function ownerDb(): Pool {
  if (pool) return pool;
  if (process.env.VERCEL_ENV === "production") throw new Error("Evals never run against production");
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is not set; point fit-coach's .env.local at the dev database");
  pool = new Pool({ connectionString, max: 4, idleTimeoutMillis: 5_000 });
  return pool;
}

export async function closeOwnerDb(): Promise<void> {
  await pool?.end();
  pool = null;
}
