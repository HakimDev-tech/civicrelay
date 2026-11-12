import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

export async function verifyDatabaseConnection(): Promise<{ ok: true }> {
  await getDb().execute(sql`SELECT 1`);
  return { ok: true };
}
