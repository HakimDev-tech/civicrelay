import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { DomainError } from "@/lib/domain/errors";
import { getDb } from "@/lib/db";
import {
  alertApprovals,
  alertVersions,
  alerts,
  feedback,
  publicationLinks,
  acknowledgements,
  organizations,
} from "@/lib/db/schema";
import { requireActiveMembership } from "./access";

const idSchema = z.string().uuid();
const reviewerRoles = ["owner", "admin", "reviewer"] as const;
const publisherRoles = ["owner", "admin", "publisher"] as const;

export async function approveAlertVersion(input: {
  organizationId: string;
  membershipId: string;
  alertVersionId: string;
  decision: "approved" | "rejected";
  comment?: string | null;
}) {
  const organizationId = idSchema.parse(input.organizationId);
  const membershipId = idSchema.parse(input.membershipId);
  const alertVersionId = idSchema.parse(input.alertVersionId);
  const comment = z.string().trim().max(2000).nullable().optional().parse(input.comment);

  await requireActiveMembership({
    organizationId,
    membershipId,
    allowedRoles: reviewerRoles,
  });

  return getDb().transaction(async (tx) => {
    const [version] = await tx
      .select({
        id: alertVersions.id,
        alertId: alertVersions.alertId,
        versionNumber: alertVersions.versionNumber,
        capMessageType: alertVersions.capMessageType,
        alertStatus: alerts.status,
      })
      .from(alertVersions)
      .innerJoin(alerts, and(
        eq(alerts.id, alertVersions.alertId),
        eq(alerts.organizationId, alertVersions.organizationId),
      ))
      .where(and(
        eq(alertVersions.id, alertVersionId),
        eq(alertVersions.organizationId, organizationId),
      ))
      .limit(1);

    if (!version) throw new DomainError("NOT_FOUND", "Alert version not found.");
    if (version.capMessageType === "Cancel" || version.alertStatus === "cancelled" || version.alertStatus === "expired") {
      throw new DomainError("INVARIANT_VIOLATION", "Cancelled or expired alert versions cannot be approved.");
    }
    if (version.alertStatus === "published") {
      throw new DomainError("CONFLICT", "A published alert version cannot be re-reviewed; create a new CAP Update instead.");
    }
    const [latestVersion] = await tx
      .select({ id: alertVersions.id })
      .from(alertVersions)
      .where(eq(alertVersions.alertId, version.alertId))
      .orderBy(desc(alertVersions.versionNumber))
      .limit(1);
    if (latestVersion?.id !== version.id) {
      throw new DomainError("CONFLICT", "Only the latest alert version can be reviewed.");
    }

    const [approval] = await tx.insert(alertApprovals).values({
      organizationId,
      alertVersionId,
      reviewerMembershipId: membershipId,
      decision: input.decision,
      comment: comment ?? null,
    }).returning();

    if (input.decision === "approved") {
      await tx.update(alerts)
        .set({ status: input.decision === "approved" ? "approved" : "in_review", updatedAt: new Date() })
        .where(and(eq(alerts.id, version.alertId), eq(alerts.organizationId, organizationId)));
    }

    return approval;
  });
}

export async function publishAlertVersion(input: {
  organizationId: string;
  membershipId: string;
  alertVersionId: string;
  approvalId: string;
  expiresAt?: Date | null;
}) {
  const organizationId = idSchema.parse(input.organizationId);
  const membershipId = idSchema.parse(input.membershipId);
  const alertVersionId = idSchema.parse(input.alertVersionId);
  const approvalId = idSchema.parse(input.approvalId);
  const expiresAt = input.expiresAt === undefined || input.expiresAt === null
    ? null
    : z.coerce.date().parse(input.expiresAt);

  await requireActiveMembership({
    organizationId,
    membershipId,
    allowedRoles: publisherRoles,
  });

  if (expiresAt && expiresAt <= new Date()) {
    throw new DomainError("VALIDATION_ERROR", "Publication expiry must be in the future.");
  }

  const rawToken = randomBytes(32).toString("base64url");
  const publicTokenHash = createHash("sha256").update(rawToken).digest("hex");

  try {
    const result = await getDb().transaction(async (tx) => {
      const [version] = await tx
        .select({
          id: alertVersions.id,
          alertId: alertVersions.alertId,
          versionNumber: alertVersions.versionNumber,
          capStatus: alertVersions.capStatus,
          alertStatus: alerts.status,
          organizationStatus: organizations.status,
        })
        .from(alertVersions)
        .innerJoin(alerts, and(
          eq(alerts.id, alertVersions.alertId),
          eq(alerts.organizationId, alertVersions.organizationId),
        ))
        .innerJoin(organizations, eq(organizations.id, alertVersions.organizationId))
        .where(and(
          eq(alertVersions.id, alertVersionId),
          eq(alertVersions.organizationId, organizationId),
        ))
        .limit(1);

      if (!version) throw new DomainError("NOT_FOUND", "Alert version not found.");
      if (version.organizationStatus !== "active") {
        throw new DomainError("FORBIDDEN", "Suspended organizations cannot publish alerts.");
      }
      if (version.capStatus !== "Actual") {
        throw new DomainError("INVARIANT_VIOLATION", "Only CAP messages with status Actual may be published publicly.");
      }
      if (version.alertStatus !== "approved" && version.alertStatus !== "published") {
        throw new DomainError("INVARIANT_VIOLATION", "The alert must be approved before publication.");
      }
      const [latestVersion] = await tx
        .select({ id: alertVersions.id })
        .from(alertVersions)
        .where(eq(alertVersions.alertId, version.alertId))
        .orderBy(desc(alertVersions.versionNumber))
        .limit(1);
      if (latestVersion?.id !== version.id) {
        throw new DomainError("CONFLICT", "Only the latest alert version can be published.");
      }
      const [latestApproval] = await tx
        .select({ id: alertApprovals.id, decision: alertApprovals.decision })
        .from(alertApprovals)
        .where(and(
          eq(alertApprovals.alertVersionId, alertVersionId),
          eq(alertApprovals.organizationId, organizationId),
        ))
        .orderBy(desc(alertApprovals.createdAt), desc(alertApprovals.id))
        .limit(1);
      if (!latestApproval || latestApproval.id !== approvalId || latestApproval.decision !== "approved") {
        throw new DomainError("FORBIDDEN", "Publication requires the latest approval decision for this exact version.");
      }

      const [link] = await tx.insert(publicationLinks).values({
        organizationId,
        alertVersionId,
        approvalId,
        publicTokenHash,
        publishedByMembershipId: membershipId,
        expiresAt,
      }).returning();

      if (!link) throw new DomainError("INVARIANT_VIOLATION", "Publication record was not returned.");

      await tx.update(alerts)
        .set({ status: "published", updatedAt: new Date() })
        .where(and(eq(alerts.id, version.alertId), eq(alerts.organizationId, organizationId)));

      return link;
    });

    // The raw capability is returned exactly once; only its SHA-256 digest is stored.
    return { publication: result, publicToken: rawToken };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("CONFLICT", "This alert version already has an active publication.");
    }
    throw error;
  }
}

export async function revokePublication(input: {
  organizationId: string;
  membershipId: string;
  publicationId: string;
}) {
  const organizationId = idSchema.parse(input.organizationId);
  const publicationId = idSchema.parse(input.publicationId);
  await requireActiveMembership({
    organizationId,
    membershipId: idSchema.parse(input.membershipId),
    allowedRoles: publisherRoles,
  });

  const [revoked] = await getDb()
    .update(publicationLinks)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(
      eq(publicationLinks.id, publicationId),
      eq(publicationLinks.organizationId, organizationId),
      eq(publicationLinks.status, "active"),
    ))
    .returning();

  if (!revoked) throw new DomainError("NOT_FOUND", "Active publication not found.");
  return revoked;
}

export async function getPublicAlertByToken(token: string) {
  const rawToken = z.string().min(32).max(128).parse(token);
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const now = new Date();

  const [result] = await getDb()
    .select({
      publicationId: publicationLinks.id,
      alertVersionId: alertVersions.id,
      publishedAt: publicationLinks.publishedAt,
      headlineFr: alertVersions.headlineFr,
      descriptionFr: alertVersions.descriptionFr,
      instructionFr: alertVersions.instructionFr,
      headlineAr: alertVersions.headlineAr,
      descriptionAr: alertVersions.descriptionAr,
      instructionAr: alertVersions.instructionAr,
      severity: alerts.severity,
      urgency: alerts.urgency,
      certainty: alerts.certainty,
      effectiveAt: alerts.effectiveAt,
      expiresAt: alerts.expiresAt,
      organizationName: organizations.name,
    })
    .from(publicationLinks)
    .innerJoin(alertVersions, eq(alertVersions.id, publicationLinks.alertVersionId))
    .innerJoin(alerts, and(
      eq(alerts.id, alertVersions.alertId),
      eq(alerts.organizationId, publicationLinks.organizationId),
    ))
    .innerJoin(organizations, eq(organizations.id, publicationLinks.organizationId))
    .where(and(
      eq(publicationLinks.publicTokenHash, tokenHash),
      eq(publicationLinks.status, "active"),
      or(isNull(publicationLinks.expiresAt), gt(publicationLinks.expiresAt, now)),
      or(isNull(alerts.expiresAt), gt(alerts.expiresAt, now)),
      eq(alerts.status, "published"),
      eq(alertVersions.capStatus, "Actual"),
      eq(organizations.status, "active")
    ))
    .limit(1);

  return result ?? null;
}

export async function recordPublicAcknowledgement(input: {
  token: string;
  type: "received" | "understood" | "safe" | "need_help";
}) {
  const publicAlert = await getPublicAlertByToken(input.token);
  if (!publicAlert) throw new DomainError("NOT_FOUND", "Published alert not found or no longer active.");

  const [entry] = await getDb().insert(acknowledgements).values({
    publicationLinkId: publicAlert.publicationId,
    alertVersionId: publicAlert.alertVersionId,
    type: z.enum(["received", "understood", "safe", "need_help"]).parse(input.type),
  }).returning();

  return entry;
}

export async function submitPublicFeedback(input: {
  token: string;
  category: "need_help" | "incorrect_information" | "accessibility_issue" | "other";
  message?: string | null;
}) {
  const publicAlert = await getPublicAlertByToken(input.token);
  if (!publicAlert) throw new DomainError("NOT_FOUND", "Published alert not found or no longer active.");

  const category = z.enum(["need_help", "incorrect_information", "accessibility_issue", "other"]).parse(input.category);
  const message = z.string().trim().max(4000).nullable().optional().parse(input.message);

  const [entry] = await getDb().insert(feedback).values({
    publicationLinkId: publicAlert.publicationId,
    alertVersionId: publicAlert.alertVersionId,
    category,
    message: message ?? null,
  }).returning();

  return entry;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
