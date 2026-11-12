import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) {
  throw new Error("DATABASE_URL_UNPOOLED is required. Migrations must use Neons direct, non-pooled connection.");
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, application_name: "civicrelay-migrations" });
const migrationsDirectory = join(process.cwd(), "drizzle");

async function main() {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort();

  if (files.length === 0) {
    console.log("No SQL migrations found.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS civicrelay_schema_migrations (filename text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const filename of files) {
      const migrationSql = await readFile(join(migrationsDirectory, filename), "utf8");
      const checksum = createHash("sha256").update(migrationSql).digest("hex");
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["civicrelay:schema-migrations"]);
        const existing = await client.query("SELECT checksum FROM civicrelay_schema_migrations WHERE filename = $1", [filename]);
        if (existing.rowCount) {
          if (existing.rows[0].checksum !== checksum) {
            throw new Error("Applied migration " + filename + " has changed. Create a new migration instead of editing history.");
          }
          await client.query("COMMIT");
          console.log("Already applied: " + filename);
          continue;
        }
        await client.query(migrationSql);
        await client.query("INSERT INTO civicrelay_schema_migrations (filename, checksum) VALUES ($1, $2)", [filename, checksum]);
        await client.query("COMMIT");
        console.log("Applied: " + filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error("Database migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
