import { Pool } from "pg";

const required = [
  "DATABASE_URL_UNPOOLED",
  "CIVICRELAY_PROVISION_CONFIRMATION",
  "CIVICRELAY_ORG_NAME",
  "CIVICRELAY_ORG_SLUG",
  "CIVICRELAY_ORG_TYPE",
  "CIVICRELAY_OWNER_EMAIL",
];

for (const key of required) {
  if (!process.env[key]?.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

if (process.env.CIVICRELAY_PROVISION_CONFIRMATION !== "PROVISION_VERIFIED_ORGANIZATION") {
  throw new Error("Provisioning blocked. Set CIVICRELAY_PROVISION_CONFIRMATION=PROVISION_VERIFIED_ORGANIZATION only after organization verification and explicit operator approval.");
}

const name = process.env.CIVICRELAY_ORG_NAME.trim();
const slug = process.env.CIVICRELAY_ORG_SLUG.trim().toLowerCase();
const type = process.env.CIVICRELAY_ORG_TYPE.trim();
const ownerEmail = process.env.CIVICRELAY_OWNER_EMAIL.trim().toLowerCase();

if (name.length < 2 || name.length > 120) throw new Error("Organization name must contain 2–120 characters.");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Organization slug must be lowercase kebab-case.");
if (!["public_agency", "emergency_service", "nonprofit", "other"].includes(type)) {
  throw new Error("Organization type must be public_agency, emergency_service, nonprofit, or other.");
}
if (ownerEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
  throw new Error("CIVICRELAY_OWNER_EMAIL must be a valid email address.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  max: 1,
  connectionTimeoutMillis: 8_000,
  application_name: "civicrelay-verified-organization-provision",
});

let client;
try {
  client = await pool.connect();
  await client.query("BEGIN");

  const ownerResult = await client.query(
    "SELECT id FROM users WHERE lower(email) = $1 AND email_verified = true FOR UPDATE",
    [ownerEmail],
  );
  if (ownerResult.rowCount !== 1) {
    throw new Error("No verified CivicRelay account matches CIVICRELAY_OWNER_EMAIL. The owner must sign up and verify their email first.");
  }

  const [owner] = ownerResult.rows;
  const organizationResult = await client.query(
    "INSERT INTO organizations (name, slug, type, status) VALUES ($1, $2, $3::organization_type, 'active') RETURNING id, slug",
    [name, slug, type],
  );
  const [organization] = organizationResult.rows;

  const membershipResult = await client.query(
    "INSERT INTO memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') RETURNING id",
    [organization.id, owner.id],
  );
  const [membership] = membershipResult.rows;

  await client.query(
    "INSERT INTO audit_logs (organization_id, actor_membership_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, 'organization.verified_bootstrap_provisioned', 'organization', $1, $3::jsonb)",
    [
      organization.id,
      membership.id,
      JSON.stringify({
        provisioningMethod: "manual_verified_bootstrap",
        organizationType: type,
        ownerEmail,
      }),
    ],
  );

  await client.query("COMMIT");
  process.stdout.write([
    "Organization provisioned successfully.",
    `Organization ID: ${organization.id}`,
    `Organization slug: ${organization.slug}`,
    `Initial owner: ${ownerEmail}`,
    "The initial owner can now sign in and invite other verified users.",
    "",
  ].join("\n"));
} catch (error) {
  if (client) {
    try { await client.query("ROLLBACK"); } catch { /* preserve the original failure */ }
  }
  const message = error instanceof Error ? error.message : "Unknown provisioning error.";
  process.stderr.write(`Organization provisioning failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
