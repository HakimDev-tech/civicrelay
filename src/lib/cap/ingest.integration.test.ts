import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { approveAlertVersion, getPublicAlertByToken, publishAlertVersion } from "@/lib/db/repositories/publication-workflow";
import { ingestCapXml } from "@/lib/cap/ingest";
import { closeDb, getDb } from "@/lib/db";
import { alerts, memberships, organizations, publicationLinks, users } from "@/lib/db/schema";

const databaseUrl = process.env.CIVICRELAY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("CAP ingestion lifecycle (dedicated Neon test branch)", () => {
  const suffix = randomUUID();
  let organizationId: string;
  let editorMembershipId: string;
  let reviewerMembershipId: string;
  let publisherMembershipId: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("CIVICRELAY_TEST_DATABASE_URL is required.");
    if (process.env.NODE_ENV === "production") throw new Error("Integration tests must never run in production.");
    process.env.DATABASE_URL = databaseUrl;

    const db = getDb();
    const [organization] = await db.insert(organizations).values({
      name: "CivicRelay CAP integration " + suffix.slice(0, 8),
      slug: "cap-integration-" + suffix,
      type: "other",
      status: "active",
    }).returning();
    if (!organization) throw new Error("Could not create integration organization.");
    organizationId = organization.id;

    const [editor, reviewer, publisher] = await Promise.all([
      db.insert(users).values({ authSubject: "cap-editor-" + suffix, displayName: "CAP Editor" }).returning(),
      db.insert(users).values({ authSubject: "cap-reviewer-" + suffix, displayName: "CAP Reviewer" }).returning(),
      db.insert(users).values({ authSubject: "cap-publisher-" + suffix, displayName: "CAP Publisher" }).returning(),
    ]).then((rows) => rows.map((row) => row[0]));
    if (!editor || !reviewer || !publisher) throw new Error("Could not create integration users.");

    const createdMemberships = await db.insert(memberships).values([
      { organizationId, userId: editor.id, role: "owner", status: "active" },
      { organizationId, userId: reviewer.id, role: "reviewer", status: "active" },
      { organizationId, userId: publisher.id, role: "publisher", status: "active" },
    ]).returning();
    editorMembershipId = createdMemberships.find((item) => item.role === "owner")!.id;
    reviewerMembershipId = createdMemberships.find((item) => item.role === "reviewer")!.id;
    publisherMembershipId = createdMemberships.find((item) => item.role === "publisher")!.id;
  }, 30_000);

  afterAll(async () => {
    await closeDb();
  });

  it("ingests Alert → Update → Cancel and revokes superseded public links", async () => {
    const fixture = (name: string) => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");

    const initial = await ingestCapXml({
      organizationId,
      membershipId: editorMembershipId,
      xml: fixture("flood-alert.xml"),
    });
    expect(initial.outcome).toBe("created");
    expect(initial.version.versionNumber).toBe(1);

    const firstApproval = await approveAlertVersion({
      organizationId,
      membershipId: reviewerMembershipId,
      alertVersionId: initial.version.id,
      decision: "approved",
    });
    const firstPublication = await publishAlertVersion({
      organizationId,
      membershipId: publisherMembershipId,
      alertVersionId: initial.version.id,
      approvalId: firstApproval.id,
    });
    expect(await getPublicAlertByToken(firstPublication.publicToken)).not.toBeNull();

    const update = await ingestCapXml({
      organizationId,
      membershipId: editorMembershipId,
      xml: fixture("flood-update.xml"),
    });
    expect(update.outcome).toBe("updated");
    expect(update.version.versionNumber).toBe(2);
    expect(await getPublicAlertByToken(firstPublication.publicToken)).toBeNull();

    const secondApproval = await approveAlertVersion({
      organizationId,
      membershipId: reviewerMembershipId,
      alertVersionId: update.version.id,
      decision: "approved",
    });
    const secondPublication = await publishAlertVersion({
      organizationId,
      membershipId: publisherMembershipId,
      alertVersionId: update.version.id,
      approvalId: secondApproval.id,
    });
    expect(await getPublicAlertByToken(secondPublication.publicToken)).not.toBeNull();

    const cancelled = await ingestCapXml({
      organizationId,
      membershipId: editorMembershipId,
      xml: fixture("flood-cancel.xml"),
    });
    expect(cancelled.outcome).toBe("cancelled");
    expect(cancelled.alert.status).toBe("cancelled");
    expect(await getPublicAlertByToken(secondPublication.publicToken)).toBeNull();

    const db = getDb();
    const storedLinks = await db.select().from(publicationLinks).where(eq(publicationLinks.organizationId, organizationId));
    expect(storedLinks).toHaveLength(2);
    expect(storedLinks.every((link) => link.status === "revoked")).toBe(true);
    const [storedAlert] = await db.select().from(alerts).where(eq(alerts.id, initial.alert.id)).limit(1);
    expect(storedAlert?.status).toBe("cancelled");
  }, 30_000);
});
