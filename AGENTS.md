# CivicRelay engineering guidelines

## Product boundary
CivicRelay transforms authoritative Common Alerting Protocol (CAP) messages into accessible, multilingual public guidance. It does not originate official warnings, replace emergency services, or publish an adaptation without explicit human approval.

## Technical baseline
- Next.js App Router, TypeScript strict mode, React, Tailwind CSS v4.
- Use Server Components by default. Add Client Components only for actual browser-side interactivity.
- Keep the application a modular monolith. Do not introduce microservices without an evidenced need.
- Keep domain logic independent from route handlers and UI components.
- Validate all external input at runtime; TypeScript types do not validate untrusted data.

## Safety and data integrity
- Preserve the original CAP payload as received; never silently rewrite it.
- Treat imported XML as untrusted input. Enforce payload size limits and safe parser settings.
- Publishing must be impossible until an authorized human has approved the exact alert version.
- Do not expose internal identifiers, database credentials, or private alert data in public routes.
- Never commit secrets. Use .env.example for variable names and placeholders only.
- Do not invent official sources, alert status, affected areas, or emergency instructions.

## Code quality
- Prefer small, cohesive modules and explicit types.
- Use runtime schemas at trust boundaries when schemas are introduced.
- Add tests for domain rules, parser edge cases, authorization, and state transitions.
- Keep accessibility, keyboard navigation, and mobile layouts first-class requirements.
- Run npm run check and npm run build before considering a change complete.

## Authentication and authorization
- Use Better Auth for identity, email verification, password credentials, and session resolution. Do not introduce a second identity provider without an explicit architecture decision.
- Resolve the current user from a verified server-side Better Auth session. Never trust user IDs, organization IDs, or membership IDs supplied by the browser as proof of identity or authorization.
- Every organization-scoped operation must resolve an active membership for the authenticated user and an active organization. Enforce role allow-lists server-side.
- Account creation does not grant organization membership or operational permissions. Never allow a user to self-assign an organization or role.
- Keep email verification mandatory. Registration must fail closed if the transactional email provider is not configured.
- Rate limiting must use shared storage suitable for serverless instances.
- Do not apply `drizzle/0004_authentication.sql` to Neon main without explicit user approval. Validate schema changes against an isolated database first.

## HTTP API security
- Cookie-authenticated mutation routes must reject cross-origin requests and use no-store responses.
- Resolve the authenticated user from the verified Better Auth server session. Resolve organization membership and role from PostgreSQL; never accept membership IDs from request payloads.
- Apply shared, database-backed rate limits before expensive parsing or writes. Do not use process-local in-memory limits for serverless routes.
- Stream and bound untrusted request bodies before parsing. Validate content types and UTF-8 explicitly.
- Public/API responses must not include stored source XML, full raw CAP payloads, secrets, or internal authorization data.
- Keep database migrations additive. Never apply new migrations to Neon main without explicit user approval.

## Organization invitation security
- Only active organization owners/admins may issue invitations. Never permit invitation-based assignment of the owner role.
- Invitation tokens must be cryptographically random, stored only as hashes, single-use, short-lived, and bound to the invitee's email.
- Require an authenticated session with a verified email matching the invitation before activating membership.
- Accept invitations transactionally; activate only the role stored in the invitation and record audit events.
- Failed email delivery must invalidate the pending invitation. Do not expose invitation tokens in API responses or logs.

## Alert review and public publication
- Only the latest CAP version may be reviewed or published. Serialize review/publication transitions with the same per-alert PostgreSQL advisory lock used by CAP ingestion.
- A publication route must resolve the latest approval server-side; never accept a client-selected approval as proof of approval.
- Publishing is a distinct human action by an authorized publisher. Never auto-publish after approval.
- Return a raw public capability token only once to the authorized publisher; persist only its SHA-256 hash.
- Public alert pages must query through the active-publication repository and exclude raw CAP XML and internal identifiers.
- Public acknowledgement/feedback routes must validate the capability token, apply shared rate limits, bound request bodies, and state clearly that submissions do not contact emergency services or guarantee a response.
- Use no-referrer/noindex behavior for capability-token pages to reduce token leakage.
