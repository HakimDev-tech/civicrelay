import "server-only";

import { DomainError } from "@/lib/domain/errors";
import { getCurrentSession } from "@/lib/auth/session";
import { requireUserMembership, type MembershipRole } from "@/lib/db/repositories/user-memberships";

export async function requireCurrentUserOrganizationAccess(input: {
  organizationId: string;
  allowedRoles?: readonly MembershipRole[];
}) {
  const session = await getCurrentSession();

  if (!session) {
    throw new DomainError("FORBIDDEN", "Authentication is required.");
  }

  const membership = await requireUserMembership({
    userId: session.user.id,
    organizationId: input.organizationId,
    allowedRoles: input.allowedRoles,
  });

  return { session, membership };
}
