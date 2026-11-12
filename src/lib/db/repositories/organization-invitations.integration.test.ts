import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db";
import {
  memberships,
  organizationInvitations,
  organizations,
  users,
} from "@/lib/db/schema";
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
} from "@/lib/db/repositories/organization-invitations";

const databaseUrl = process.env.CIVICRELAY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("organization invitation lifecycle", () => {
  const suffix = randomUUID();
  const invitedEmail = `invitee-${suffix}@example.invalid`;
  let organizationId: string;
  let inviterMembershipId: string;
  let inviteeUserId: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("CIVICRELAY_TEST_DATABASE_URL is required.");
    if (process.env.NODE_ENV === "production") throw new Error("Integration tests must never run in production.");
    if (process.env.CIVICRELAY_TEST_DATABASE_CONFIRMATION !== "ISOLATED_BRANCH") {
      throw new Error("Organization invitation tests require an explicitly isolated test database.");
    }
    process.env.DATABASE_URL = databaseUrl;

    const db = getDb();
    const [organization] = await db.insert(organizations).values({
      name: "CivicRelay invitation integration " + suffix.slice(0, 8),
      slug: "invite-integration-" + suffix,
      type: "other",
      status: "active",
    }).returning();
    if (!organization) throw new Error("Could not create integration organization.");
    organizationId = organization.id;

    const [inviter, invitee] = await db.insert(users).values([
      {
        authSubject: "invite-owner-" + suffix,
        email: `owner-${suffix}@example.invalid`,
        emailVerified: true,
        displayName: "Invitation Owner",
      },
      {
        authSubject: "invite-user-" + suffix,
        email: invitedEmail,
        emailVerified: true,
        displayName: "Invited User",
      },
    ]).returning();
    if (!inviter || !invitee) throw new Error("Could not create invitation integration users.");
    inviteeUserId = invitee.id;

    const [membership] = await db.insert(memberships).values({
      organizationId,
      userId: inviter.id,
      role: "owner",
      status: "active",
    }).returning();
    if (!membership) throw new Error("Could not create owner membership.");
    inviterMembershipId = membership.id;
  }, 30_000);

  afterAll(async () => {
    if (databaseUrl) await closeDb();
  });

  it("issues a single-use, email-bound invitation and activates the assigned role", async () => {
    const invitation = await createOrganizationInvitation({
      organizationId,
      inviterMembershipId,
      email: invitedEmail.toUpperCase(),
      role: "editor",
    });

    expect(invitation.email).toBe(invitedEmail);
    expect(invitation.role).toBe("editor");
    expect(invitation.token).toHaveLength(43);

    const [stored] = await getDb()
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, invitation.id))
      .limit(1);
    expect(stored?.tokenHash).toHaveLength(64);
    expect(stored?.tokenHash).not.toBe(invitation.token);

    await expect(acceptOrganizationInvitation({
      token: invitation.token,
      userId: inviteeUserId,
      email: "different@example.invalid",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const accepted = await acceptOrganizationInvitation({
      token: invitation.token,
      userId: inviteeUserId,
      email: invitedEmail,
    });

    expect(accepted.organizationId).toBe(organizationId);
    expect(accepted.role).toBe("editor");

    const [membership] = await getDb()
      .select()
      .from(memberships)
      .where(eq(memberships.id, accepted.membershipId))
      .limit(1);
    expect(membership?.status).toBe("active");
    expect(membership?.role).toBe("editor");

    await expect(acceptOrganizationInvitation({
      token: invitation.token,
      userId: inviteeUserId,
      email: invitedEmail,
    })).rejects.toMatchObject({ code: "CONFLICT" });
  }, 30_000);
});
