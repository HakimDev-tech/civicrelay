import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db";
import { apiRateLimits } from "@/lib/db/schema";
import { enforceSharedRateLimit } from "@/lib/security/rate-limit";

const databaseUrl = process.env.CIVICRELAY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("shared API rate limiting", () => {
  const rawKey = "rate-limit-integration:" + randomUUID();
  const storedKey = createHash("sha256").update(rawKey, "utf8").digest("hex");

  beforeAll(() => {
    if (!databaseUrl) throw new Error("CIVICRELAY_TEST_DATABASE_URL is required.");
    if (process.env.NODE_ENV === "production") throw new Error("Integration tests must never run in production.");
    if (process.env.CIVICRELAY_TEST_DATABASE_CONFIRMATION !== "ISOLATED_BRANCH") {
      throw new Error("Rate-limit integration tests require an explicitly isolated test database.");
    }
    process.env.DATABASE_URL = databaseUrl;
  });

  afterAll(async () => {
    if (process.env.DATABASE_URL) {
      await getDb().delete(apiRateLimits).where(eq(apiRateLimits.key, storedKey));
    }
    await closeDb();
  });

  it("counts concurrent application requests in shared PostgreSQL storage", async () => {
    await enforceSharedRateLimit({ key: rawKey, limit: 2, windowSeconds: 60 });
    await enforceSharedRateLimit({ key: rawKey, limit: 2, windowSeconds: 60 });

    await expect(
      enforceSharedRateLimit({ key: rawKey, limit: 2, windowSeconds: 60 }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
