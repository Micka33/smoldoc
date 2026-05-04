import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(pool: Pool): Promise<void> {
  const sqlPath = join(__dirname, "migrations", "001_init.sql");
  const sql = await readFile(sqlPath, "utf8");
  await pool.query(sql);
}
