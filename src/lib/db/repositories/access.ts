import "server-only";
import { and, eq } from "drizzle-orm";
import { DomainError } from "@/lib/domain/errors";
import { getDb } from "@/lib/db";
import { memberships, organizations, type Membership } from "@/lib/db/schema";

export type MembershipRole = Membership["role"];

export async function requireActiveMembership(input: {
  organizationId: string;
  membershipId: string;
  allowedRoles?: readonly MembershipRole[];
}): Promise<Membership> {
  const [result] = await getDb()
    .select({ membership: memberships })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(
      eq(memberships.id, input.membershipId),
      eq(memberships.organizationId, input.organizationId),
      eq(memberships.status, "active"),
      eq(organizations.status, "active"),
    ))
    .limit(1);

  const membership = result?.membership;
  if (!membership) {
    throw new DomainError("FORBIDDEN", "An active membership in an active organization is required.");
  }

  if (input.allowedRoles && !input.allowedRoles.includes(membership.role)) {
    throw new DomainError("FORBIDDEN", "This membership does not have permission to perform this action.");
  }

  return membership;
}
