import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(pool: Pool): Promise<void> {
  const dir = join(__dirname, "migrations");
  for (const name of ["001_init.sql", "002_semantic_layer_b.sql"]) {
    const sqlPath = join(dir, name);
    const sql = await readFile(sqlPath, "utf8");
    await pool.query(sql);
  }
}
