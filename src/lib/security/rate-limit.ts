import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { DomainError } from "@/lib/domain/errors";
import { getDb } from "@/lib/db";
import { apiRateLimits } from "@/lib/db/schema";

export async function enforceSharedRateLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<void> {
  if (!input.key || !Number.isSafeInteger(input.limit) || input.limit < 1 ||
      !Number.isSafeInteger(input.windowSeconds) || input.windowSeconds < 1) {
    throw new Error("Invalid shared rate-limit configuration.");
  }

  // Hash identifiers before persistence; the table stores no email, user ID, or raw membership ID.
  const key = createHash("sha256").update(input.key, "utf8").digest("hex");
  const now = new Date();
  const windowStartCutoff = new Date(now.getTime() - input.windowSeconds * 1000);

  const [state] = await getDb()
    .insert(apiRateLimits)
    .values({ key, windowStartedAt: now, count: 1 })
    .onConflictDoUpdate({
      target: apiRateLimits.key,
      set: {
        count: sql`CASE WHEN ${apiRateLimits.windowStartedAt} <= ${windowStartCutoff} THEN 1 ELSE ${apiRateLimits.count} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${apiRateLimits.windowStartedAt} <= ${windowStartCutoff} THEN ${now} ELSE ${apiRateLimits.windowStartedAt} END`,
      },
    })
    .returning({ count: apiRateLimits.count });

  if (!state) {
    throw new Error("Shared rate-limit state could not be persisted.");
  }
  if (state.count > input.limit) {
    throw new DomainError("RATE_LIMITED", "Too many CAP import attempts. Try again after the current rate-limit window.");
  }
}
