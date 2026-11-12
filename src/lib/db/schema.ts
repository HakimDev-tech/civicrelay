import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const organizationTypeEnum = pgEnum("organization_type", [
  "public_agency", "emergency_service", "nonprofit", "other",
]);
export const organizationStatusEnum = pgEnum("organization_status", ["active", "suspended"]);
export const membershipRoleEnum = pgEnum("membership_role", [
  "owner", "admin", "editor", "reviewer", "publisher", "reader",
]);
export const membershipStatusEnum = pgEnum("membership_status", ["invited", "active", "suspended"]);
export const alertStatusEnum = pgEnum("alert_status", [
  "draft", "in_review", "approved", "published", "expired", "cancelled",
]);
export const capStatusEnum = pgEnum("cap_status", ["Actual", "Exercise", "System", "Test", "Draft"]);
export const capMessageTypeEnum = pgEnum("cap_message_type", ["Alert", "Update", "Cancel", "Ack", "Error"]);
export const capSeverityEnum = pgEnum("cap_severity", ["Extreme", "Severe", "Moderate", "Minor", "Unknown"]);
export const capUrgencyEnum = pgEnum("cap_urgency", ["Immediate", "Expected", "Future", "Past", "Unknown"]);
export const capCertaintyEnum = pgEnum("cap_certainty", ["Observed", "Likely", "Possible", "Unlikely", "Unknown"]);
export const approvalDecisionEnum = pgEnum("approval_decision", ["approved", "rejected"]);
export const publicationStatusEnum = pgEnum("publication_status", ["active", "revoked", "expired"]);
export const acknowledgementTypeEnum = pgEnum("acknowledgement_type", [
  "received", "understood", "safe", "need_help",
]);
export const feedbackCategoryEnum = pgEnum("feedback_category", [
  "need_help", "incorrect_information", "accessibility_issue", "other",
]);
export const feedbackStatusEnum = pgEnum("feedback_status", ["open", "triaged", "resolved", "closed"]);

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  type: organizationTypeEnum("type").notNull().default("other"),
  status: organizationStatusEnum("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("organizations_slug_uidx").on(table.slug),
  unique("organizations_id_id_unique").on(table.id),
  check("organizations_slug_format_check", sql`\${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  authSubject: text("auth_subject").notNull(),
  email: text("email"),
  displayName: text("display_name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("users_auth_subject_uidx").on(table.authSubject),
]);

export const memberships = pgTable("memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  role: membershipRoleEnum("role").notNull().default("reader"),
  status: membershipStatusEnum("status").notNull().default("invited"),
  createdAt: createdAt(),
}, (table) => [
  unique("memberships_org_user_unique").on(table.organizationId, table.userId),
  unique("memberships_id_org_unique").on(table.id, table.organizationId),
  index("memberships_user_idx").on(table.userId),
]);

export const alerts = pgTable("alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  sourceSender: text("source_sender").notNull(),
  sourceIdentifier: text("source_identifier").notNull(),
  status: alertStatusEnum("status").notNull().default("draft"),
  severity: capSeverityEnum("severity").notNull().default("Unknown"),
  urgency: capUrgencyEnum("urgency").notNull().default("Unknown"),
  certainty: capCertaintyEnum("certainty").notNull().default("Unknown"),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
  effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  createdByMembershipId: uuid("created_by_membership_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique("alerts_id_org_unique").on(table.id, table.organizationId),
  unique("alerts_source_identity_unique").on(table.organizationId, table.sourceSender, table.sourceIdentifier),
  index("alerts_org_status_updated_idx").on(table.organizationId, table.status, table.updatedAt),
  check("alerts_expiration_check", sql`\${table.expiresAt} IS NULL OR \${table.effectiveAt} IS NULL OR \${table.expiresAt} > \${table.effectiveAt}`),
]);

export const alertVersions = pgTable("alert_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  alertId: uuid("alert_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  capSender: text("cap_sender").notNull(),
  capIdentifier: text("cap_identifier").notNull(),
  capSentAt: timestamp("cap_sent_at", { withTimezone: true, mode: "date" }).notNull(),
  capStatus: capStatusEnum("cap_status").notNull(),
  capMessageType: capMessageTypeEnum("cap_message_type").notNull(),
  sourceXml: text("source_xml").notNull(),
  sourcePayload: jsonb("source_payload").$type<Record<string, unknown>>().notNull(),
  sourceSha256: text("source_sha256").notNull(),
  headlineFr: text("headline_fr"),
  descriptionFr: text("description_fr"),
  instructionFr: text("instruction_fr"),
  headlineAr: text("headline_ar"),
  descriptionAr: text("description_ar"),
  instructionAr: text("instruction_ar"),
  createdByMembershipId: uuid("created_by_membership_id").notNull(),
  createdAt: createdAt(),
}, (table) => [
  unique("alert_versions_id_org_unique").on(table.id, table.organizationId),
  unique("alert_versions_alert_version_unique").on(table.alertId, table.versionNumber),
  index("alert_versions_alert_created_idx").on(table.alertId, table.createdAt),
  check("alert_versions_number_check", sql`\${table.versionNumber} > 0`),
  check("alert_versions_sha256_check", sql`\${table.sourceSha256} ~ '^[a-f0-9]{64}$'`),
]);

export const alertAreas = pgTable("alert_areas", {
  id: uuid("id").defaultRandom().primaryKey(),
  alertVersionId: uuid("alert_version_id").notNull().references(() => alertVersions.id, { onDelete: "restrict" }),
  areaName: text("area_name").notNull(),
  description: text("description"),
  sourceArea: jsonb("source_area").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
}, (table) => [index("alert_areas_version_idx").on(table.alertVersionId)]);

export const alertApprovals = pgTable("alert_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  alertVersionId: uuid("alert_version_id").notNull(),
  reviewerMembershipId: uuid("reviewer_membership_id").notNull(),
  decision: approvalDecisionEnum("decision").notNull(),
  comment: text("comment"),
  createdAt: createdAt(),
}, (table) => [
  unique("alert_approvals_id_version_unique").on(table.id, table.alertVersionId),
  index("alert_approvals_version_created_idx").on(table.alertVersionId, table.createdAt),
]);

export const publicationLinks = pgTable("publication_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  alertVersionId: uuid("alert_version_id").notNull(),
  approvalId: uuid("approval_id").notNull(),
  publicTokenHash: text("public_token_hash").notNull(),
  status: publicationStatusEnum("status").notNull().default("active"),
  publishedByMembershipId: uuid("published_by_membership_id").notNull(),
  publishedAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  unique("publication_links_id_version_unique").on(table.id, table.alertVersionId),
  uniqueIndex("publication_links_token_hash_uidx").on(table.publicTokenHash),
  index("publication_links_status_expiry_idx").on(table.status, table.expiresAt),
  check("publication_links_token_hash_check", sql`\${table.publicTokenHash} ~ '^[a-f0-9]{64}$'`),
]);

export const acknowledgements = pgTable("acknowledgements", {
  id: uuid("id").defaultRandom().primaryKey(),
  publicationLinkId: uuid("publication_link_id").notNull(),
  alertVersionId: uuid("alert_version_id").notNull(),
  type: acknowledgementTypeEnum("type").notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("acknowledgements_publication_created_idx").on(table.publicationLinkId, table.createdAt),
  index("acknowledgements_version_type_idx").on(table.alertVersionId, table.type),
]);

export const feedback = pgTable("feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  publicationLinkId: uuid("publication_link_id").notNull(),
  alertVersionId: uuid("alert_version_id").notNull(),
  category: feedbackCategoryEnum("category").notNull(),
  message: text("message"),
  status: feedbackStatusEnum("status").notNull().default("open"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index("feedback_status_created_idx").on(table.status, table.createdAt),
  index("feedback_publication_created_idx").on(table.publicationLinkId, table.createdAt),
  check("feedback_message_length_check", sql`\${table.message} IS NULL OR char_length(\${table.message}) <= 4000`),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  actorMembershipId: uuid("actor_membership_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (table) => [
  index("audit_logs_org_created_idx").on(table.organizationId, table.createdAt),
  index("audit_logs_entity_idx").on(table.entityType, table.entityId),
]);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type AlertVersion = typeof alertVersions.$inferSelect;
export type NewAlertVersion = typeof alertVersions.$inferInsert;
