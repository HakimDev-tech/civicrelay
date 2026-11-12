import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";
import {
  auditLogs,
  memberships,
  organizationInvitations,
  organizations,
  users,
  type MembershipRole,
} from "@/lib/db/schema";

const uuidSchema = z.string().uuid();
const inviteRoleSchema = z.enum(["admin", "editor", "reviewer", "publisher", "reader"]);
const inviteEmailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function createOrganizationInvitation(input: {
  organizationId: string;
  inviterMembershipId: string;
  email: string;
  role: Exclude<MembershipRole, "owner">;
}) {
  const organizationId = uuidSchema.parse(input.organizationId);
  const inviterMembershipId = uuidSchema.parse(input.inviterMembershipId);
  const email = inviteEmailSchema.parse(input.email);
  const role = inviteRoleSchema.parse(input.role);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  try {
    const invitation = await getDb().transaction(async (tx) => {
      const [inviter] = await tx
        .select({
          role: memberships.role,
          membershipStatus: memberships.status,
          organizationStatus: organizations.status,
          organizationName: organizations.name,
        })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
        .where(and(
          eq(memberships.id, inviterMembershipId),
          eq(memberships.organizationId, organizationId),
        ))
        .for("update")
        .limit(1);

      if (!inviter || inviter.membershipStatus !== "active" || inviter.organizationStatus !== "active") {
        throw new DomainError("FORBIDDEN", "An active organization membership is required.");
      }
      if (inviter.role !== "owner" && inviter.role !== "admin") {
        throw new DomainError("FORBIDDEN", "Only organization owners and administrators can invite members.");
      }

      // Expired invitations must leave the partial unique index before a replacement can be issued.
      await tx.update(organizationInvitations)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(organizationInvitations.organizationId, organizationId),
          sql`lower(${organizationInvitations.email}) = ${email}`,
          sql`${organizationInvitations.expiresAt} <= now()`,
          sql`${organizationInvitations.acceptedAt} IS NULL`,
          sql`${organizationInvitations.revokedAt} IS NULL`,
        ));

      const [existingMembership] = await tx
        .select({ status: memberships.status })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(
          eq(memberships.organizationId, organizationId),
          sql`lower(${users.email}) = ${email}`,
        ))
        .for("update")
        .limit(1);

      if (existingMembership && existingMembership.status !== "invited") {
        throw new DomainError("CONFLICT", "This user already has an active or suspended membership in the organization.");
      }

      const [created] = await tx.insert(organizationInvitations).values({
        organizationId,
        email,
        role,
        tokenHash,
        invitedByMembershipId,
        expiresAt,
      }).returning({
        id: organizationInvitations.id,
        email: organizationInvitations.email,
        role: organizationInvitations.role,
        expiresAt: organizationInvitations.expiresAt,
      });

      if (!created) throw new DomainError("INVARIANT_VIOLATION", "Invitation creation did not return a record.");

      await tx.insert(auditLogs).values({
        organizationId,
        actorMembershipId: inviterMembershipId,
        action: "organization.invitation_created",
        entityType: "organization_invitation",
        entityId: created.id,
        metadata: { email, role, expiresAt: expiresAt.toISOString() },
      });

      return { ...created, organizationName: inviter.organizationName };
    });

    return { ...invitation, token };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("CONFLICT", "A pending invitation already exists for this email address.");
    }
    throw error;
  }
}

export async function revokeUndeliveredOrganizationInvitation(input: {
  organizationId: string;
  invitationId: string;
  inviterMembershipId: string;
}) {
  await getDb().transaction(async (tx) => {
    await tx.update(organizationInvitations)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(organizationInvitations.id, uuidSchema.parse(input.invitationId)),
        eq(organizationInvitations.organizationId, uuidSchema.parse(input.organizationId)),
        sql`${organizationInvitations.acceptedAt} IS NULL`,
        sql`${organizationInvitations.revokedAt} IS NULL`,
      ));

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorMembershipId: input.inviterMembershipId,
      action: "organization.invitation_delivery_failed",
      entityType: "organization_invitation",
      entityId: input.invitationId,
      metadata: {},
    });
  });
}

export async function acceptOrganizationInvitation(input: {
  token: string;
  userId: string;
  email: string;
}) {
  const token = z.string().min(32).max(256).parse(input.token);
  const userId = uuidSchema.parse(input.userId);
  const email = inviteEmailSchema.parse(input.email);
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");

  return getDb().transaction(async (tx) => {
    const [invitation] = await tx
      .select({
        invitation: organizationInvitations,
        organizationStatus: organizations.status,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
      })
      .from(organizationInvitations)
      .innerJoin(organizations, eq(organizations.id, organizationInvitations.organizationId))
      .where(eq(organizationInvitations.tokenHash, tokenHash))
      .for("update")
      .limit(1);

    if (!invitation) throw new DomainError("NOT_FOUND", "This invitation is invalid or no longer available.");
    if (invitation.invitation.acceptedAt || invitation.invitation.revokedAt ||
        invitation.invitation.expiresAt <= new Date()) {
      throw new DomainError("CONFLICT", "This invitation has expired, been revoked, or already been used.");
    }
    if (invitation.organizationStatus !== "active") {
      throw new DomainError("FORBIDDEN", "This organization is not active.");
    }
    if (invitation.invitation.email !== email) {
      throw new DomainError("FORBIDDEN", "The verified account email does not match this invitation.");
    }

    const [existingMembership] = await tx
      .select()
      .from(memberships)
      .where(and(
        eq(memberships.organizationId, invitation.invitation.organizationId),
        eq(memberships.userId, userId),
      ))
      .for("update")
      .limit(1);

    let membership;
    if (existingMembership) {
      if (existingMembership.status !== "invited") {
        throw new DomainError("CONFLICT", "This account already has a membership in the organization.");
      }
      const [activated] = await tx.update(memberships)
        .set({ role: invitation.invitation.role, status: "active" })
        .where(eq(memberships.id, existingMembership.id))
        .returning();
      if (!activated) throw new DomainError("INVARIANT_VIOLATION", "The invited membership could not be activated.");
      membership = activated;
    } else {
      const [created] = await tx.insert(memberships).values({
        organizationId: invitation.invitation.organizationId,
        userId,
        role: invitation.invitation.role,
        status: "active",
      }).returning();
      if (!created) throw new DomainError("INVARIANT_VIOLATION", "The organization membership could not be created.");
      membership = created;
    }

    await tx.update(organizationInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(organizationInvitations.id, invitation.invitation.id));

    await tx.insert(auditLogs).values({
      organizationId: invitation.invitation.organizationId,
      actorMembershipId: membership.id,
      action: "organization.invitation_accepted",
      entityType: "organization_invitation",
      entityId: invitation.invitation.id,
      metadata: { role: membership.role },
    });

    return {
      organizationId: invitation.invitation.organizationId,
      organizationName: invitation.organizationName,
      organizationSlug: invitation.organizationSlug,
      membershipId: membership.id,
      role: membership.role,
    };
  });
}
