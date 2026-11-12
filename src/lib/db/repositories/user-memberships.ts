import "server-only";

import { and, eq } from "drizzle-orm";
import { DomainError } from "@/lib/domain/errors";
import { getDb } from "@/lib/db";
import { memberships, organizations, type Membership, type MembershipRole } from "@/lib/db/schema";

export async function listActiveMembershipsForUser(userId: string) {
  return getDb()
    .select({
      membership: memberships,
      organization: organizations,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(
      eq(memberships.userId, userId),
      eq(memberships.status, "active"),
      eq(organizations.status, "active"),
    ))
    .orderBy(organizations.name);
}

export async function requireUserMembership(input: {
  userId: string;
  organizationId: string;
  allowedRoles?: readonly MembershipRole[];
}): Promise<Membership> {
  const [result] = await getDb()
    .select({ membership: memberships })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(
      eq(memberships.userId, input.userId),
      eq(memberships.organizationId, input.organizationId),
      eq(memberships.status, "active"),
      eq(organizations.status, "active"),
    ))
    .limit(1);

  const membership = result?.membership;
  if (!membership) {
    throw new DomainError("FORBIDDEN", "No active membership exists for this user in the requested organization.");
  }

  if (input.allowedRoles && !input.allowedRoles.includes(membership.role)) {
    throw new DomainError("FORBIDDEN", "This membership does not have permission to perform this action.");
  }

  return membership;
}
