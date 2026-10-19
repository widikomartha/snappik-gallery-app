import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

export const migrationDir = path.resolve(process.cwd(), "src/db/migrations");
export async function migrationFiles() {
  return Promise.all((await readdir(migrationDir)).filter(x => /^\d{3}_.+\.sql$/.test(x)).sort().map(async name => {
    const sql = await readFile(`${migrationDir}/${name}`, "utf8");
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }));
}
export async function migrate(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(71001)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = (await client.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
    const files = await migrationFiles();
    for (let i = 0; i < applied.length; i++) if (files[i]?.name !== applied[i].name || files[i]?.checksum !== applied[i].checksum) throw new Error("Migration history mismatch");
    for (const file of files.slice(applied.length)) {
      await client.query("BEGIN");
      try {
        await client.query(file.sql);
        await client.query("INSERT INTO schema_migrations (name,checksum) VALUES ($1,$2)", [file.name, file.checksum]);
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(71001)");
    client.release();
  }
}
export async function ready(pool: Pool) {
  const files = await migrationFiles();
  const applied = (await pool.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
  if (applied.length !== files.length || files.some((f, i) => applied[i]?.name !== f.name || applied[i]?.checksum !== f.checksum)) throw new Error("Schema not ready");
  await pool.query("SELECT id FROM studios LIMIT 0");
}
