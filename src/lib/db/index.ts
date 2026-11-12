import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type Database = NodePgDatabase<typeof schema>;
type DbGlobal = typeof globalThis & { __civicRelayPool?: Pool; __civicRelayDb?: Database };
const globalForDb = globalThis as DbGlobal;

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is missing. Configure the pooled Neon connection string.");
  }

  return new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
    application_name: "civicrelay-web",
  });
}

export function getDb(): Database {
  const pool = globalForDb.__civicRelayPool ?? (globalForDb.__civicRelayPool = createPool());
  return globalForDb.__civicRelayDb ?? (globalForDb.__civicRelayDb = drizzle(pool, { schema }));
}

export { schema };
