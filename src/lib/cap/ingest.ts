import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { parseCapXml, type NormalizedCapAlert } from "@/lib/cap/parser";
import { DomainError } from "@/lib/domain/errors";
import { getDb } from "@/lib/db";
import {
  alertAreas,
  alertVersions,
  alerts,
  auditLogs,
  type Alert,
  type AlertVersion,
} from "@/lib/db/schema";
import { requireActiveMembership } from "@/lib/db/repositories/access";

const inputSchema = z.object({
  organizationId: z.string().uuid(),
  membershipId: z.string().uuid(),
  xml: z.string().min(1),
});

const editorRoles = ["owner", "admin", "editor"] as const;

type IngestOutcome = "created" | "updated" | "cancelled";

function parseReference(reference: string): { sender: string; identifier: string; sentAt: Date } {
  const parts = reference.split(",");
  if (parts.length !== 3) {
    throw new DomainError("VALIDATION_ERROR", "CAP reference must use sender,identifier,sent format.");
  }
  const sentAt = new Date(parts[2]);
  if (!parts[0] || !parts[1] || !Number.isFinite(sentAt.getTime())) {
    throw new DomainError("VALIDATION_ERROR", "CAP reference contains an invalid sender, identifier, or timestamp.");
  }
  return { sender: parts[0], identifier: parts[1], sentAt };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function versionValues(data: NormalizedCapAlert, organizationId: string, alertId: string, membershipId: string, versionNumber: number) {
  const projection = data.repository;
  return {
    organizationId,
    alertId,
    versionNumber,
    capSender: data.sender,
    capIdentifier: data.identifier,
    capSentAt: data.sentAt,
    capStatus: data.status,
    capMessageType: data.messageType,
    capReferences: data.references,
    sourceXml: data.sourceXml,
    sourcePayload: data.sourcePayload,
    sourceSha256: data.sourceSha256,
    headlineFr: projection.headlineFr,
    descriptionFr: projection.descriptionFr,
    instructionFr: projection.instructionFr,
    headlineAr: projection.headlineAr,
    descriptionAr: projection.descriptionAr,
    instructionAr: projection.instructionAr,
    createdByMembershipId: membershipId,
  };
}

export async function ingestCapXml(input: z.input<typeof inputSchema>): Promise<{
  outcome: IngestOutcome;
  alert: Alert;
  version: AlertVersion;
  issues: ReturnType<typeof parseCapXml> extends infer R ? R extends { issues: infer I } ? I : never : never;
}> {
  const request = inputSchema.parse(input);
  await requireActiveMembership({
    organizationId: request.organizationId,
    membershipId: request.membershipId,
    allowedRoles: editorRoles,
  });

  const parsed = parseCapXml(request.xml);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", "CAP XML failed structural or semantic validation.", {
      issues: parsed.issues,
    });
  }
  const cap = parsed.data;
  if (cap.messageType !== "Alert" && cap.messageType !== "Update" && cap.messageType !== "Cancel") {
    throw new DomainError("VALIDATION_ERROR", "This intake workflow accepts Alert, Update, and Cancel messages. Ack and Error messages are parsed but not ingested as public alert records.", {
      messageType: cap.messageType,
    });
  }

  const maxBytes = Number(process.env.CAP_MAX_PAYLOAD_BYTES ?? 1_048_576);
  const actualBytes = Buffer.byteLength(cap.sourceXml, "utf8");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || actualBytes > maxBytes) {
    throw new DomainError("VALIDATION_ERROR", "CAP XML payload exceeds the configured size limit.", {
      actualBytes,
      maxBytes,
    });
  }

  try {
    const result = await getDb().transaction(async (tx) => {
      let parentAlert: Alert | undefined;
      let outcome: IngestOutcome;

      if (cap.messageType === "Alert") {
        const [createdAlert] = await tx.insert(alerts).values({
          organizationId: request.organizationId,
          sourceSender: cap.sender,
          sourceIdentifier: cap.identifier,
          status: "draft",
          severity: cap.repository.severity,
          urgency: cap.repository.urgency,
          certainty: cap.repository.certainty,
          sentAt: cap.sentAt,
          effectiveAt: cap.repository.effectiveAt,
          expiresAt: cap.repository.expiresAt,
          createdByMembershipId: request.membershipId,
        }).returning();
        if (!createdAlert) throw new DomainError("INVARIANT_VIOLATION", "Alert insert did not return a record.");
        parentAlert = createdAlert;
        outcome = "created";
      } else {
        const references = cap.references.map(parseReference);
        if (references.length === 0) {
          throw new DomainError("VALIDATION_ERROR", "Update and Cancel messages require at least one resolvable reference.");
        }

        const resolved = [];
        for (const reference of references) {
          const [match] = await tx
            .select({
              alert: alerts,
              versionId: alertVersions.id,
              versionNumber: alertVersions.versionNumber,
            })
            .from(alertVersions)
            .innerJoin(alerts, and(
              eq(alerts.id, alertVersions.alertId),
              eq(alerts.organizationId, alertVersions.organizationId),
            ))
            .where(and(
              eq(alertVersions.organizationId, request.organizationId),
              eq(alertVersions.capSender, reference.sender),
              eq(alertVersions.capIdentifier, reference.identifier),
              eq(alertVersions.capSentAt, reference.sentAt),
            ))
            .limit(1);
          if (!match) {
            throw new DomainError("NOT_FOUND", "A CAP reference does not resolve to a previously ingested message in this organization.", {
              sender: reference.sender,
              identifier: reference.identifier,
              sent: reference.sentAt.toISOString(),
            });
          }
          resolved.push(match);
        }

        const parentIds = new Set(resolved.map((item) => item.alert.id));
        if (parentIds.size !== 1) {
          throw new DomainError("VALIDATION_ERROR", "This product workflow requires all references in one Update or Cancel to resolve to the same alert record.");
        }

        const parentId = resolved[0].alert.id;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${parentId}))`);

        const [latest] = await tx
          .select()
          .from(alertVersions)
          .where(and(
            eq(alertVersions.alertId, parentId),
            eq(alertVersions.organizationId, request.organizationId),
          ))
          .orderBy(desc(alertVersions.versionNumber))
          .limit(1);

        if (!latest || !resolved.some((item) => item.versionId === latest.id)) {
          throw new DomainError("CONFLICT", "The referenced CAP message is no longer the current version; refusing to apply a stale Update or Cancel.");
        }
        if (cap.sentAt <= latest.capSentAt) {
          throw new DomainError("CONFLICT", "An Update or Cancel must have a sent timestamp later than the version it references.");
        }
        if (resolved[0].alert.status === "cancelled" || resolved[0].alert.status === "expired") {
          throw new DomainError("CONFLICT", "A cancelled or expired alert cannot be updated.");
        }
        parentAlert = resolved[0].alert;
        outcome = cap.messageType === "Update" ? "updated" : "cancelled";
      }

      if (!parentAlert) throw new DomainError("INVARIANT_VIOLATION", "CAP ingestion did not resolve an alert record.");

      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${parentAlert.id}))`);
      const [latestVersion] = await tx
        .select({ versionNumber: alertVersions.versionNumber })
        .from(alertVersions)
        .where(eq(alertVersions.alertId, parentAlert.id))
        .orderBy(desc(alertVersions.versionNumber))
        .limit(1);

      const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
      const [version] = await tx.insert(alertVersions)
        .values(versionValues(cap, request.organizationId, parentAlert.id, request.membershipId, versionNumber))
        .returning();
      if (!version) throw new DomainError("INVARIANT_VIOLATION", "CAP version insert did not return a record.");

      const areaRows = cap.infos.flatMap((info) => info.areas.map((area) => ({
        alertVersionId: version.id,
        areaName: area.description,
        description: area.description,
        sourceArea: {
          polygons: area.polygons,
          circles: area.circles,
          geocodes: area.geocodes,
          altitude: area.altitude,
          ceiling: area.ceiling,
          language: info.language,
        },
      })));
      if (areaRows.length > 0) await tx.insert(alertAreas).values(areaRows);

      const [updatedAlert] = await tx.update(alerts)
        .set({
          status: cap.messageType === "Cancel" ? "cancelled" : cap.messageType === "Update" ? "in_review" : "draft",
          severity: cap.repository.severity,
          urgency: cap.repository.urgency,
          certainty: cap.repository.certainty,
          sentAt: cap.sentAt,
          effectiveAt: cap.repository.effectiveAt,
          expiresAt: cap.repository.expiresAt,
          updatedAt: new Date(),
        })
        .where(and(
          eq(alerts.id, parentAlert.id),
          eq(alerts.organizationId, request.organizationId),
        ))
        .returning();
      if (!updatedAlert) throw new DomainError("INVARIANT_VIOLATION", "Parent alert could not be updated.");

      await tx.insert(auditLogs).values({
        organizationId: request.organizationId,
        actorMembershipId: request.membershipId,
        action: "cap.message_ingested",
        entityType: "alert",
        entityId: updatedAlert.id,
        metadata: {
          messageType: cap.messageType,
          capSender: cap.sender,
          capIdentifier: cap.identifier,
          capSentAt: cap.sentAt.toISOString(),
          versionNumber,
          sourceSha256: cap.sourceSha256,
          references: cap.references,
        },
      });

      return { outcome, alert: updatedAlert, version };
    });

    return { ...result, issues: parsed.issues };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("CONFLICT", "This CAP sender and identifier has already been ingested in this organization.");
    }
    throw error;
  }
}
