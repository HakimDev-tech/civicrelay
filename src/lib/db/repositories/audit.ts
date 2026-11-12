import "server-only";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { requireActiveMembership } from "./access";

const auditInputSchema = z.object({
  organizationId: z.string().uuid(),
  membershipId: z.string().uuid().nullable(),
  action: z.string().trim().min(1).max(120),
  entityType: z.string().trim().min(1).max(80),
  entityId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export async function appendAuditLog(input: z.input<typeof auditInputSchema>) {
  const data = auditInputSchema.parse(input);
  if (data.membershipId) {
    await requireActiveMembership({
      organizationId: data.organizationId,
      membershipId: data.membershipId,
    });
  }

  const [entry] = await getDb().insert(auditLogs).values({
    organizationId: data.organizationId,
    actorMembershipId: data.membershipId,
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId ?? null,
    metadata: data.metadata,
  }).returning();

  return entry;
}
