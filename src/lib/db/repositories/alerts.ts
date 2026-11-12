import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { DomainError } from "@/lib/domain/errors";
import { getDb } from "@/lib/db";
import {
  alertVersions,
  alerts,
  type Alert,
  type AlertVersion,
  type NewAlert,
} from "@/lib/db/schema";
import { requireActiveMembership } from "./access";

const uuidSchema = z.string().uuid();
const createAlertSchema = z.object({
  organizationId: uuidSchema,
  membershipId: uuidSchema,
  sourceSender: z.string().trim().min(1).max(255),
  sourceIdentifier: z.string().trim().min(1).max(255),
  severity: z.enum(["Extreme", "Severe", "Moderate", "Minor", "Unknown"]).optional(),
  urgency: z.enum(["Immediate", "Expected", "Future", "Past", "Unknown"]).optional(),
  certainty: z.enum(["Observed", "Likely", "Possible", "Unlikely", "Unknown"]).optional(),
  sentAt: z.coerce.date().optional(),
  effectiveAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
}).refine((value) => !value.expiresAt || !value.effectiveAt || value.expiresAt > value.effectiveAt, {
  message: "expiresAt must be later than effectiveAt",
  path: ["expiresAt"],
});

const createVersionSchema = z.object({
  organizationId: uuidSchema,
  membershipId: uuidSchema,
  alertId: uuidSchema,
  capSender: z.string().trim().min(1).max(255),
  capIdentifier: z.string().trim().min(1).max(255),
  capSentAt: z.coerce.date(),
  capStatus: z.enum(["Actual", "Exercise", "System", "Test", "Draft"]),
  capMessageType: z.enum(["Alert", "Update", "Cancel", "Ack", "Error"]),
  capReferences: z.array(z.string().max(1024)).max(100).default([]),
  sourceXml: z.string().min(1),
  sourcePayload: z.record(z.string(), z.unknown()),
  headlineFr: z.string().max(500).nullable().optional(),
  descriptionFr: z.string().max(10000).nullable().optional(),
  instructionFr: z.string().max(10000).nullable().optional(),
  headlineAr: z.string().max(500).nullable().optional(),
  descriptionAr: z.string().max(10000).nullable().optional(),
  instructionAr: z.string().max(10000).nullable().optional(),
});

const MAX_CAP_BYTES = Number(process.env.CAP_MAX_PAYLOAD_BYTES ?? 1_048_576);
const EDITOR_ROLES = ["owner", "admin", "editor"] as const;

export async function createAlertDraft(input: z.input<typeof createAlertSchema>): Promise<Alert> {
  const data = createAlertSchema.parse(input);
  await requireActiveMembership({
    organizationId: data.organizationId,
    membershipId: data.membershipId,
    allowedRoles: EDITOR_ROLES,
  });

  const values: NewAlert = {
    organizationId: data.organizationId,
    sourceSender: data.sourceSender,
    sourceIdentifier: data.sourceIdentifier,
    severity: data.severity ?? "Unknown",
    urgency: data.urgency ?? "Unknown",
    certainty: data.certainty ?? "Unknown",
    sentAt: data.sentAt,
    effectiveAt: data.effectiveAt,
    expiresAt: data.expiresAt,
    createdByMembershipId: data.membershipId,
  };

  try {
    const [created] = await getDb().insert(alerts).values(values).returning();
    if (!created) throw new DomainError("INVARIANT_VIOLATION", "The database did not return the created alert.");
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("CONFLICT", "An alert with this CAP sender and identifier already exists in this organization.");
    }
    throw error;
  }
}

export async function listAlerts(input: {
  organizationId: string;
  membershipId: string;
  limit?: number;
  status?: Alert["status"];
}): Promise<Alert[]> {
  const organizationId = uuidSchema.parse(input.organizationId);
  const membershipId = uuidSchema.parse(input.membershipId);
  await requireActiveMembership({ organizationId, membershipId });

  const limit = z.number().int().min(1).max(100).catch(25).parse(input.limit ?? 25);
  const conditions = [eq(alerts.organizationId, organizationId)];
  if (input.status) conditions.push(eq(alerts.status, input.status));

  return getDb()
    .select()
    .from(alerts)
    .where(and(...conditions))
    .orderBy(desc(alerts.updatedAt), desc(alerts.id))
    .limit(limit);
}

export async function getAlertById(input: {
  organizationId: string;
  membershipId: string;
  alertId: string;
}): Promise<Alert> {
  const organizationId = uuidSchema.parse(input.organizationId);
  const alertId = uuidSchema.parse(input.alertId);
  await requireActiveMembership({
    organizationId,
    membershipId: uuidSchema.parse(input.membershipId),
  });

  const [alert] = await getDb()
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, alertId), eq(alerts.organizationId, organizationId)))
    .limit(1);

  if (!alert) throw new DomainError("NOT_FOUND", "Alert not found.");
  return alert;
}

export async function createAlertVersion(input: z.input<typeof createVersionSchema>): Promise<AlertVersion> {
  const data = createVersionSchema.parse(input);
  await requireActiveMembership({
    organizationId: data.organizationId,
    membershipId: data.membershipId,
    allowedRoles: EDITOR_ROLES,
  });

  const byteLength = Buffer.byteLength(data.sourceXml, "utf8");
  if (!Number.isSafeInteger(MAX_CAP_BYTES) || MAX_CAP_BYTES < 1 || byteLength > MAX_CAP_BYTES) {
    throw new DomainError("VALIDATION_ERROR", "CAP XML payload exceeds the configured size limit.", {
      actualBytes: byteLength,
      maxBytes: MAX_CAP_BYTES,
    });
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    const [parent] = await tx
      .select({ id: alerts.id })
      .from(alerts)
      .where(and(
        eq(alerts.id, data.alertId),
        eq(alerts.organizationId, data.organizationId),
      ))
      .limit(1);

    if (!parent) throw new DomainError("NOT_FOUND", "Alert not found in this organization.");

    const [latest] = await tx
      .select({ versionNumber: alertVersions.versionNumber })
      .from(alertVersions)
      .where(eq(alertVersions.alertId, data.alertId))
      .orderBy(desc(alertVersions.versionNumber))
      .limit(1);

    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const sourceSha256 = createHash("sha256").update(data.sourceXml, "utf8").digest("hex");

    const [created] = await tx.insert(alertVersions).values({
      organizationId: data.organizationId,
      alertId: data.alertId,
      versionNumber,
      capSender: data.capSender,
      capIdentifier: data.capIdentifier,
      capSentAt: data.capSentAt,
      capStatus: data.capStatus,
      capMessageType: data.capMessageType,
      capReferences: data.capReferences,
      sourceXml: data.sourceXml,
      sourcePayload: data.sourcePayload,
      sourceSha256,
      headlineFr: data.headlineFr ?? null,
      descriptionFr: data.descriptionFr ?? null,
      instructionFr: data.instructionFr ?? null,
      headlineAr: data.headlineAr ?? null,
      descriptionAr: data.descriptionAr ?? null,
      instructionAr: data.instructionAr ?? null,
      createdByMembershipId: data.membershipId,
    }).returning();

    if (!created) throw new DomainError("INVARIANT_VIOLATION", "The database did not return the created alert version.");
    return created;
  });
}

export async function listAlertVersions(input: {
  organizationId: string;
  membershipId: string;
  alertId: string;
}): Promise<AlertVersion[]> {
  const organizationId = uuidSchema.parse(input.organizationId);
  const alertId = uuidSchema.parse(input.alertId);
  await requireActiveMembership({
    organizationId,
    membershipId: uuidSchema.parse(input.membershipId),
  });

  const [parent] = await getDb()
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.id, alertId), eq(alerts.organizationId, organizationId)))
    .limit(1);
  if (!parent) throw new DomainError("NOT_FOUND", "Alert not found.");

  return getDb()
    .select()
    .from(alertVersions)
    .where(and(eq(alertVersions.alertId, alertId), eq(alertVersions.organizationId, organizationId)))
    .orderBy(desc(alertVersions.versionNumber));
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
