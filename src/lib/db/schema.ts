import {
  bigint, boolean, check, foreignKey, index, integer, jsonb, pgEnum, pgTable, text,
  timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const organizationTypeEnum = pgEnum("organization_type", ["public_agency", "emergency_service", "nonprofit", "other"]);
export const organizationStatusEnum = pgEnum("organization_status", ["active", "suspended"]);
export const membershipRoleEnum = pgEnum("membership_role", ["owner", "admin", "editor", "reviewer", "publisher", "reader"]);
export const membershipStatusEnum = pgEnum("membership_status", ["invited", "active", "suspended"]);
export const alertStatusEnum = pgEnum("alert_status", ["draft", "in_review", "approved", "published", "expired", "cancelled"]);
export const capStatusEnum = pgEnum("cap_status", ["Actual", "Exercise", "System", "Test", "Draft"]);
export const capMessageTypeEnum = pgEnum("cap_message_type", ["Alert", "Update", "Cancel", "Ack", "Error"]);
export const capSeverityEnum = pgEnum("cap_severity", ["Extreme", "Severe", "Moderate", "Minor", "Unknown"]);
export const capUrgencyEnum = pgEnum("cap_urgency", ["Immediate", "Expected", "Future", "Past", "Unknown"]);
export const capCertaintyEnum = pgEnum("cap_certainty", ["Observed", "Likely", "Possible", "Unlikely", "Unknown"]);
export const approvalDecisionEnum = pgEnum("approval_decision", ["approved", "rejected"]);
export const publicationStatusEnum = pgEnum("publication_status", ["active", "revoked", "expired"]);
export const acknowledgementTypeEnum = pgEnum("acknowledgement_type", ["received", "understood", "safe", "need_help"]);
export const feedbackCategoryEnum = pgEnum("feedback_category", ["need_help", "incorrect_information", "accessibility_issue", "other"]);
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
}, (t) => [
  uniqueIndex("organizations_slug_uidx").on(t.slug),
  check("organizations_slug_format_check", sql`${t.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  authSubject: text("auth_subject"),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  displayName: text("display_name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("users_auth_subject_uidx").on(t.authSubject),
  uniqueIndex("users_email_uidx").on(t.email),
]);

export const memberships = pgTable("memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  role: membershipRoleEnum("role").notNull().default("reader"),
  status: membershipStatusEnum("status").notNull().default("invited"),
  createdAt: createdAt(),
}, (t) => [
  unique("memberships_org_user_unique").on(t.organizationId, t.userId),
  unique("memberships_id_org_unique").on(t.id, t.organizationId),
  index("memberships_user_idx").on(t.userId),
]);

export const organizationInvitations = pgTable("organization_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  email: text("email").notNull(),
  role: membershipRoleEnum("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedByMembershipId: uuid("invited_by_membership_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("organization_invitations_token_hash_uidx").on(t.tokenHash),
  uniqueIndex("organization_invitations_pending_email_uidx")
    .on(t.organizationId, sql`lower(${t.email})`)
    .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
  index("organization_invitations_expiry_idx").on(t.expiresAt),
  check("organization_invitations_role_check", sql`${t.role} <> 'owner'::membership_role`),
  check("organization_invitations_token_hash_check", sql`${t.tokenHash} ~ '^[a-f0-9]{64}
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
}, (t) => [
  unique("alerts_id_org_unique").on(t.id, t.organizationId),
  unique("alerts_source_identity_unique").on(t.organizationId, t.sourceSender, t.sourceIdentifier),
  index("alerts_org_status_updated_idx").on(t.organizationId, t.status, t.updatedAt),
  check("alerts_expiration_check", sql`${t.expiresAt} IS NULL OR ${t.effectiveAt} IS NULL OR ${t.expiresAt} > ${t.effectiveAt}`),
  foreignKey({ columns: [t.createdByMembershipId, t.organizationId], foreignColumns: [memberships.id, memberships.organizationId] }).onDelete("restrict"),
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
  capReferences: jsonb("cap_references").$type<string[]>().notNull().default([]),
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
}, (t) => [
  unique("alert_versions_id_org_unique").on(t.id, t.organizationId),
  unique("alert_versions_alert_version_unique").on(t.alertId, t.versionNumber),
  index("alert_versions_alert_created_idx").on(t.alertId, t.createdAt),
  check("alert_versions_number_check", sql`${t.versionNumber} > 0`),
  check("alert_versions_sha256_check", sql`${t.sourceSha256} ~ '^[a-f0-9]{64}$'`),
  foreignKey({ columns: [t.alertId, t.organizationId], foreignColumns: [alerts.id, alerts.organizationId] }).onDelete("restrict"),
  foreignKey({ columns: [t.createdByMembershipId, t.organizationId], foreignColumns: [memberships.id, memberships.organizationId] }).onDelete("restrict"),
]);

export const alertAreas = pgTable("alert_areas", {
  id: uuid("id").defaultRandom().primaryKey(),
  alertVersionId: uuid("alert_version_id").notNull().references(() => alertVersions.id, { onDelete: "restrict" }),
  areaName: text("area_name").notNull(),
  description: text("description"),
  sourceArea: jsonb("source_area").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
}, (t) => [index("alert_areas_version_idx").on(t.alertVersionId)]);

export const alertApprovals = pgTable("alert_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  alertVersionId: uuid("alert_version_id").notNull(),
  reviewerMembershipId: uuid("reviewer_membership_id").notNull(),
  decision: approvalDecisionEnum("decision").notNull(),
  comment: text("comment"),
  createdAt: createdAt(),
}, (t) => [
  unique("alert_approvals_id_version_unique").on(t.id, t.alertVersionId),
  index("alert_approvals_version_created_idx").on(t.alertVersionId, t.createdAt),
  foreignKey({ columns: [t.alertVersionId, t.organizationId], foreignColumns: [alertVersions.id, alertVersions.organizationId] }).onDelete("restrict"),
  foreignKey({ columns: [t.reviewerMembershipId, t.organizationId], foreignColumns: [memberships.id, memberships.organizationId] }).onDelete("restrict"),
]);

export const publicationLinks = pgTable("publication_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  alertVersionId: uuid("alert_version_id").notNull(),
  approvalId: uuid("approval_id").notNull(),
  publicTokenHash: text("public_token_hash").notNull(),
  status: publicationStatusEnum("status").notNull().default("active"),
  publishedByMembershipId: uuid("published_by_membership_id").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
}, (t) => [
  unique("publication_links_id_version_unique").on(t.id, t.alertVersionId),
  uniqueIndex("publication_links_token_hash_uidx").on(t.publicTokenHash),
  uniqueIndex("publication_links_one_active_per_version_uidx").on(t.alertVersionId).where(sql`${t.status} = 'active'`),
  index("publication_links_status_expiry_idx").on(t.status, t.expiresAt),
  check("publication_links_token_hash_check", sql`${t.publicTokenHash} ~ '^[a-f0-9]{64}$'`),
  check("publication_links_expiry_check", sql`${t.expiresAt} IS NULL OR ${t.expiresAt} > ${t.publishedAt}`),
  check("publication_links_revocation_check", sql`${t.revokedAt} IS NULL OR ${t.status} = 'revoked'`),
  foreignKey({ columns: [t.alertVersionId, t.organizationId], foreignColumns: [alertVersions.id, alertVersions.organizationId] }).onDelete("restrict"),
  foreignKey({ columns: [t.approvalId, t.alertVersionId], foreignColumns: [alertApprovals.id, alertApprovals.alertVersionId] }).onDelete("restrict"),
  foreignKey({ columns: [t.publishedByMembershipId, t.organizationId], foreignColumns: [memberships.id, memberships.organizationId] }).onDelete("restrict"),
]);

export const acknowledgements = pgTable("acknowledgements", {
  id: uuid("id").defaultRandom().primaryKey(),
  publicationLinkId: uuid("publication_link_id").notNull(),
  alertVersionId: uuid("alert_version_id").notNull(),
  type: acknowledgementTypeEnum("type").notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("acknowledgements_publication_created_idx").on(t.publicationLinkId, t.createdAt),
  index("acknowledgements_version_type_idx").on(t.alertVersionId, t.type),
  foreignKey({ columns: [t.publicationLinkId, t.alertVersionId], foreignColumns: [publicationLinks.id, publicationLinks.alertVersionId] }).onDelete("restrict"),
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
}, (t) => [
  index("feedback_status_created_idx").on(t.status, t.createdAt),
  index("feedback_publication_created_idx").on(t.publicationLinkId, t.createdAt),
  check("feedback_message_length_check", sql`${t.message} IS NULL OR char_length(${t.message}) <= 4000`),
  foreignKey({ columns: [t.publicationLinkId, t.alertVersionId], foreignColumns: [publicationLinks.id, publicationLinks.alertVersionId] }).onDelete("restrict"),
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
}, (t) => [
  index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
  index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  foreignKey({ columns: [t.actorMembershipId, t.organizationId], foreignColumns: [memberships.id, memberships.organizationId] }).onDelete("restrict"),
]);


export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  token: text("token").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [
  uniqueIndex("auth_sessions_token_uidx").on(t.token),
  index("auth_sessions_user_id_idx").on(t.userId),
]);

export const authAccounts = pgTable("auth_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: "date" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("auth_accounts_provider_account_uidx").on(t.providerId, t.accountId),
  index("auth_accounts_user_id_idx").on(t.userId),
]);

export const authVerifications = pgTable("auth_verifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("auth_verifications_identifier_idx").on(t.identifier)]);


export const apiRateLimits = pgTable("api_rate_limits", {
  key: text("key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true, mode: "date" }).notNull(),
  count: integer("count").notNull(),
});

export const authRateLimits = pgTable("auth_rate_limits", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
}, (t) => [uniqueIndex("auth_rate_limits_key_uidx").on(t.key)]);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type MembershipRole = typeof membershipRoleEnum.enumValues[number];
export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type AlertVersion = typeof alertVersions.$inferSelect;
export type NewAlertVersion = typeof alertVersions.$inferInsert;
`),
  check("organization_invitations_expiry_check", sql`${t.expiresAt} > ${t.createdAt}`),
  check("organization_invitations_terminal_check", sql`${t.acceptedAt} IS NULL OR ${t.revokedAt} IS NULL`),
  foreignKey({
    columns: [t.invitedByMembershipId, t.organizationId],
    foreignColumns: [memberships.id, memberships.organizationId],
  }).onDelete("restrict"),
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
}, (t) => [
  unique("alerts_id_org_unique").on(t.id, t.organizationId),
  unique("alerts_source_identity_unique").on(t.organizationId, t.sourceSender, t.sourceIdentifier),
  index("alerts_org_status_updated_idx").on(t.organizationId, t.status, t.updatedAt),
  check("alerts_expiration_check", sql`${t.expiresAt} IS NULL OR ${t.effectiveAt} IS NULL OR ${t.expiresAt} > ${t.effectiveAt}`),
  foreignKey({ columns: [t.createdByMembershipId, t.organizationId], foreignColumns: [memberships.id, memberships.organizationId] }).onDelete("restrict"),
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
  capReferences: jsonb("cap_references").$type<string[]>().notNull().default([]),
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
}, (t) => [
  unique("alert_versions_id_org_unique").on(t.id, t.organizationId),
  unique("alert_versions_alert_version_unique").on(t.alertId, t.versionNumber),
  index("alert_versions_alert_created_idx").on(t.alertId, t.createdAt),
  check("alert_versions_number_check", sql`${t.versionNumber} > 0`),
  check("alert_versions_sha256_check", sql`${t.sourceSha256} ~ '^[a-f0-9]{64}$'`),
  foreignKey({ columns: [t.alertId, t.organizationId], foreignColumns: [alerts.id, alerts.organizationId] }).onDelete("restrict"),
  foreignKey({ columns: [t.createdByMembershipId, t.organizationId], foreignColumns: [memberships.id, memberships.organizationId] }).onDelete("restrict"),
]);

export const alertAreas = pgTable("alert_areas", {
  id: uuid("id").defaultRandom().primaryKey(),
  alertVersionId: uuid("alert_version_id").notNull().references(() => alertVersions.id, { onDelete: "restrict" }),
  areaName: text("area_name").notNull(),
  description: text("description"),
  sourceArea: jsonb("source_area").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
}, (t) => [index("alert_areas_version_idx").on(t.alertVersionId)]);

export const alertApprovals = pgTable("alert_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  alertVersionId: uuid("alert_version_id").notNull(),
  reviewerMembershipId: uuid("reviewer_membership_id").notNull(),
  decision: approvalDecisionEnum("decision").notNull(),
  comment: text("comment"),
  createdAt: createdAt(),
}, (t) => [
  unique("alert_approvals_id_version_unique").on(t.id, t.alertVersionId),
  index("alert_approvals_version_created_idx").on(t.alertVersionId, t.createdAt),
  foreignKey({ columns: [t.alertVersionId, t.organizationId], foreignColumns: [alertVersions.id, alertVersions.organizationId] }).onDelete("restrict"),
  foreignKey({ columns: [t.reviewerMembershipId, t.organizationId], foreignColumns: [memberships.id, memberships.organizationId] }).onDelete("restrict"),
]);

export const publicationLinks = pgTable("publication_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  alertVersionId: uuid("alert_version_id").notNull(),
  approvalId: uuid("approval_id").notNull(),
  publicTokenHash: text("public_token_hash").notNull(),
  status: publicationStatusEnum("status").notNull().default("active"),
  publishedByMembershipId: uuid("published_by_membership_id").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
}, (t) => [
  unique("publication_links_id_version_unique").on(t.id, t.alertVersionId),
  uniqueIndex("publication_links_token_hash_uidx").on(t.publicTokenHash),
  uniqueIndex("publication_links_one_active_per_version_uidx").on(t.alertVersionId).where(sql`${t.status} = 'active'`),
  index("publication_links_status_expiry_idx").on(t.status, t.expiresAt),
  check("publication_links_token_hash_check", sql`${t.publicTokenHash} ~ '^[a-f0-9]{64}$'`),
  check("publication_links_expiry_check", sql`${t.expiresAt} IS NULL OR ${t.expiresAt} > ${t.publishedAt}`),
  check("publication_links_revocation_check", sql`${t.revokedAt} IS NULL OR ${t.status} = 'revoked'`),
  foreignKey({ columns: [t.alertVersionId, t.organizationId], foreignColumns: [alertVersions.id, alertVersions.organizationId] }).onDelete("restrict"),
  foreignKey({ columns: [t.approvalId, t.alertVersionId], foreignColumns: [alertApprovals.id, alertApprovals.alertVersionId] }).onDelete("restrict"),
  foreignKey({ columns: [t.publishedByMembershipId, t.organizationId], foreignColumns: [memberships.id, memberships.organizationId] }).onDelete("restrict"),
]);

export const acknowledgements = pgTable("acknowledgements", {
  id: uuid("id").defaultRandom().primaryKey(),
  publicationLinkId: uuid("publication_link_id").notNull(),
  alertVersionId: uuid("alert_version_id").notNull(),
  type: acknowledgementTypeEnum("type").notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("acknowledgements_publication_created_idx").on(t.publicationLinkId, t.createdAt),
  index("acknowledgements_version_type_idx").on(t.alertVersionId, t.type),
  foreignKey({ columns: [t.publicationLinkId, t.alertVersionId], foreignColumns: [publicationLinks.id, publicationLinks.alertVersionId] }).onDelete("restrict"),
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
}, (t) => [
  index("feedback_status_created_idx").on(t.status, t.createdAt),
  index("feedback_publication_created_idx").on(t.publicationLinkId, t.createdAt),
  check("feedback_message_length_check", sql`${t.message} IS NULL OR char_length(${t.message}) <= 4000`),
  foreignKey({ columns: [t.publicationLinkId, t.alertVersionId], foreignColumns: [publicationLinks.id, publicationLinks.alertVersionId] }).onDelete("restrict"),
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
}, (t) => [
  index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
  index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  foreignKey({ columns: [t.actorMembershipId, t.organizationId], foreignColumns: [memberships.id, memberships.organizationId] }).onDelete("restrict"),
]);


export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  token: text("token").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [
  uniqueIndex("auth_sessions_token_uidx").on(t.token),
  index("auth_sessions_user_id_idx").on(t.userId),
]);

export const authAccounts = pgTable("auth_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: "date" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("auth_accounts_provider_account_uidx").on(t.providerId, t.accountId),
  index("auth_accounts_user_id_idx").on(t.userId),
]);

export const authVerifications = pgTable("auth_verifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("auth_verifications_identifier_idx").on(t.identifier)]);


export const apiRateLimits = pgTable("api_rate_limits", {
  key: text("key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true, mode: "date" }).notNull(),
  count: integer("count").notNull(),
});

export const authRateLimits = pgTable("auth_rate_limits", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
}, (t) => [uniqueIndex("auth_rate_limits_key_uidx").on(t.key)]);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type MembershipRole = typeof membershipRoleEnum.enumValues[number];
export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type AlertVersion = typeof alertVersions.$inferSelect;
export type NewAlertVersion = typeof alertVersions.$inferInsert;
