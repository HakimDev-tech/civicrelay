# CivicRelay

**Make emergency information understandable, accessible, and actionable for everyone.**

CivicRelay is a human-in-the-loop emergency communication platform. It takes authoritative Common Alerting Protocol (CAP) alerts and helps authorized teams prepare accessible, multilingual public guidance, review it, publish it, and understand whether people have acknowledged it or need help.

> CivicRelay does not issue official warnings or replace emergency authorities. Adaptations require human approval before publication.

## Product scope

- Import and validate official CAP XML messages.
- Preserve the original source message and its provenance.
- Prepare accessible French and Arabic adaptations for human review.
- Require explicit approval before publication.
- Publish a public alert page with acknowledgement and feedback actions.
- Track alert lifecycle, acknowledgements, feedback, and audit events.

## Technology

- Next.js App Router + React + TypeScript
- Tailwind CSS v4
- PostgreSQL on Neon
- Runtime validation and automated tests, added with the relevant domain modules

## Requirements

- Node.js 20.9+
- pnpm 10+

## Local development (Git Bash)

    pnpm install
    cp .env.example .env.local
    pnpm dev

Open http://localhost:3000.

Before database-backed features are enabled, configure both Neon connection strings in .env.local:

- DATABASE_URL: pooled connection string for application queries (hostname contains -pooler).
- DATABASE_URL_UNPOOLED: direct connection string for schema migrations (hostname does not contain -pooler).

Never commit .env.local or any real database credential.

## Database

- PostgreSQL is hosted on Neon; Drizzle ORM defines the typed application schema.
- SQL migrations live in drizzle/ and are applied in filename order.
- The migration runner uses DATABASE_URL_UNPOOLED, a transaction-scoped advisory lock, and SHA-256 checksums. Applied migration files must never be edited; add a new migration instead.
- Application code obtains the server-only database client through getDb() from src/lib/db.
- Tenant ownership is represented explicitly by organization_id and composite foreign keys. The browser must never connect directly to PostgreSQL.
- Original CAP XML and its parsed payload are retained per immutable alert version. Publication records reference the exact approved version.
- Public access tokens are stored only as SHA-256 hashes. Public endpoints must check active publication status and expiry.
- Better Auth manages email/password credentials, verified-email status, sessions, and verification records in PostgreSQL. The `users` UUID remains the foreign-key target for organization memberships.

Apply pending migrations with:

    pnpm db:migrate

Open Drizzle Studio with:

    pnpm db:studio

## Quality checks

    pnpm check
    pnpm build

## Project structure

    src/
      app/          App Router routes, layouts and global styles
      components/   Shared UI components
      features/     Product capabilities grouped by domain
      lib/          Shared infrastructure and utilities

## Status

The database foundation, CAP parser, transactional ingestion service, review/publication repositories, authenticated CAP import API, organization invitations, and automated tests are implemented. Better Auth is integrated for email/password authentication, email verification, password resets, and server-side session resolution. Organization membership remains separately controlled by CivicRelay; signing up never grants access to an organization.


## CAP 1.2 ingestion

The server-side CAP module is under `src/lib/cap/`:

- `parser.ts` performs XML syntax checks, CAP namespace validation, field and enum validation, OASIS timezone semantics, WGS 84 geometry checks, language validation, size limits, and SHA-256 source fingerprinting.
- `schema/CAP-v1.2.xsd` bundles the normative OASIS CAP 1.2 XML Schema; `xsd.ts` validates each message against it with `libxml2-wasm` in addition to the application-level semantic checks. The XSD retains its OASIS copyright notice. See the [OASIS CAP 1.2 Standard](https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2.html) and its normative schema at `https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2.xsd`.
- `ingest.ts` is a server-only transactional service for `Alert`, `Update`, and `Cancel` messages.
- `fixtures/` contains a representative flood alert lifecycle in French and Arabic.
- `parser.test.ts` contains parser regression tests, including XSD-backed namespace, timestamp, sequence, and vocabulary checks, run by `pnpm test` and included in `pnpm check`.
- `ingest.integration.test.ts` exercises the complete Alert → Update → Cancel lifecycle against a dedicated PostgreSQL test branch. It is skipped unless `CIVICRELAY_TEST_DATABASE_URL` is set.

### Operational ingestion policy

- Only `scope=Public` and `status=Actual` messages enter the operational alert workflow. Exercise, Test, System, and Draft messages can be parsed for validation but are not ingested for public operations.
- `Alert` creates a draft alert and immutable source version. The workflow requires at least one `info` block before ingestion.
- `Update` must reference the current version of an existing alert, carry a later `sent` timestamp, and include revised public guidance. It moves the alert back to review.
- `Cancel` must reference the current version. It marks the alert cancelled and preserves the last known severity and timing metadata.
- A superseding Update or Cancel revokes active publication links for prior versions in the same transaction. A replacement version must receive a new human approval.
- Only the latest version with CAP status `Actual`, an active organization, and the latest approved review decision can be published.
- CAP `Ack` and `Error` messages are parsed but are not inserted as public alert records.

### Security boundaries

- XML DTD and custom entity declarations are rejected. The parser does not dereference external resources or URLs found in CAP payloads.
- CAP payload size is limited by `CAP_MAX_PAYLOAD_BYTES` (default: 1 MiB).
- Original XML is stored unchanged alongside its parsed payload and SHA-256 digest.
- Version allocation is serialized per alert; ingestion locks the active membership and organization during the write transaction.
- Publication lifecycle constraints are enforced in PostgreSQL as well as in the application service. Revoked/expired links cannot be reactivated.
- The parser and ingestion service are server-side modules. The authenticated import endpoint is `POST /api/organizations/:organizationId/alerts/import`; it accepts raw CAP XML with `application/cap+xml`, `application/xml`, or `text/xml` content types.
- The endpoint requires a same-origin request, resolves the active user membership from the verified Better Auth session, and permits only owner/admin/editor roles. The organization ID is a route selector only; membership and role are independently checked server-side.
- Request bodies are streamed with a hard byte limit before XML parsing. A PostgreSQL-backed atomic rate limiter allows at most 10 import attempts per membership per 60 seconds across serverless instances.
- The endpoint returns alert/version metadata and parser issues, never the stored source XML or full parsed CAP payload.
- Organization owners/admins can issue invitations through `POST /api/organizations/:organizationId/invitations`; invitation tokens are random, single-use, stored only as SHA-256 hashes, and expire after seven days.
- Invitees must sign in with the invited email, verify that address, and accept through `POST /api/invitations/accept`. The acceptance transaction activates only the assigned non-owner role and records an audit event. Invitation delivery failure revokes the pending invitation.
- The dashboard exposes the invitation form only to owners/admins. Owner privileges cannot be granted through invitations.
- The organization workspace at `/dashboard/:organizationId` lists alerts and provides CAP XML intake for owner/admin/editor roles. Alert detail pages show the latest French/Arabic adaptation and immutable version history.
- Review decisions are submitted through `POST /api/organizations/:organizationId/alerts/:alertId/review`; only owner/admin/reviewer roles can approve or reject the latest version. Every decision is audited.
- Publication is submitted through `POST /api/organizations/:organizationId/alerts/:alertId/publish`; only owner/admin/publisher roles can publish, and the endpoint resolves the latest approved decision server-side. Publishing returns the one-time public capability URL to the authorized publisher.
- Public alert pages are served at `/alerts/:token`. Acknowledgements and feedback are recorded through public endpoints with token-scoped shared rate limits. Public submissions do not contact emergency services or guarantee a response.

### CAP fixtures

- `src/lib/cap/fixtures/flood-alert.xml` — initial French/Arabic flood warning.
- `src/lib/cap/fixtures/flood-update.xml` — revised warning referencing the initial message.
- `src/lib/cap/fixtures/flood-cancel.xml` — cancellation referencing the current update.

Run the full checks with:

    pnpm check
    pnpm build

Run the database-backed lifecycle test only against a dedicated disposable Neon branch (never the production `main` branch):

    export CIVICRELAY_TEST_DATABASE_URL="<dedicated-test-branch-connection-string>"
    export CIVICRELAY_TEST_DATABASE_CONFIRMATION="ISOLATED_BRANCH"
    pnpm test:integration


## Neon database configuration

1. In the Neon console, open the `civicrelay` project and select the `main` branch.
2. Copy the **pooled** connection string for application traffic into `DATABASE_URL`.
3. Copy the **direct / unpooled** connection string into `DATABASE_URL_UNPOOLED`; the migration runner uses this connection.
4. Keep both values only in `.env.local` locally and in the deployment platform's encrypted environment-variable settings. Never commit either value.

The application database client is server-only. Import it from `@/lib/db` only in Server Components, Route Handlers, Server Actions, or other server-side modules. Never expose database URLs or credentials to browser code.

### Database commands

- `pnpm db:migrate` — apply pending SQL migrations (direct connection required).
- `pnpm db:studio` — open Drizzle Studio.

### Repository security contract

Repository functions accept an organization ID and membership ID so authorization can be checked against PostgreSQL. Route handlers must obtain the authenticated user from the trusted authentication provider, resolve their active membership server-side, and pass that membership ID to the repository. **Never accept a membership ID or organization ID as proof of identity from an untrusted request body.**

All alert and alert-version queries are scoped to an organization. Alert versions preserve the original CAP XML and SHA-256 digest and are immutable in PostgreSQL; corrections must create a new version.

## Authentication

- Better Auth is mounted at `/api/auth/*` and uses the existing Neon PostgreSQL database through Drizzle.
- Email/password sign-up requires a verified email address before sign-in. Passwords must contain at least 12 characters.
- Password reset and verification emails are sent through Resend. Configure `RESEND_API_KEY` and a verified `AUTH_EMAIL_FROM` sender before enabling account registration.
- Set `BETTER_AUTH_SECRET` to a unique secret of at least 32 characters. Generate one with `openssl rand -base64 32`.
- Set `BETTER_AUTH_URL` to the canonical application origin in production. It may be omitted for Vercel Preview deployments so the request origin can be inferred.
- `src/proxy.ts` performs a lightweight session-cookie check for dashboard navigation. Protected server operations must still call `auth.api.getSession()` and resolve the current user's active organization membership from PostgreSQL.
- A new account receives **no organization membership by default**. An authorized organization owner/admin must issue an invitation; the invited user must accept it with the matching verified email. Owner privileges cannot be assigned through invitations. Never accept user, organization, or membership IDs from the browser as proof of authorization.
- Authentication tables are added by `drizzle/0004_authentication.sql`; shared API rate-limit storage is added by `drizzle/0005_api_rate_limits.sql`; organization invitations are added by `drizzle/0006_organization_invitations.sql`. All migrations from `0000` through `0006` have been applied and checksum-verified on the current Neon main branch. Apply the same committed migrations to any new environment with `pnpm db:migrate`.

### Initial organization provisioning

CivicRelay does not let arbitrary sign-ups create operational emergency organizations or self-assign owner privileges. After verifying an organization's legitimacy through the appropriate offline process, an operator can provision its first owner using the guarded script:

1. The designated owner first creates a CivicRelay account and verifies their email.
2. Apply the approved authentication migration to the intended database.
3. Set `DATABASE_URL_UNPOOLED`, `CIVICRELAY_ORG_NAME`, `CIVICRELAY_ORG_SLUG`, `CIVICRELAY_ORG_TYPE`, and `CIVICRELAY_OWNER_EMAIL` in the operator's private environment.
4. Set `CIVICRELAY_PROVISION_CONFIRMATION=PROVISION_VERIFIED_ORGANIZATION` only after organization verification and explicit operator approval.
5. Run `pnpm org:provision`.

The script uses the direct database connection, requires an already verified user, creates the organization and its first active owner membership in one transaction, and records an audit event. It never creates user accounts, grants owner access through a public API, or prints database credentials. Do not run it against Neon main until migrations and organization verification have been explicitly approved.

## Authentication environment variables

See `.env.example`. Keep all values in encrypted Vercel environment variables or `.env.local`; never commit real credentials.

### Operational security note

Rate limiting is enabled with PostgreSQL-backed shared storage, including stricter rules for sign-in, sign-up, password reset, and verification requests. GitHub Actions also provisions an ephemeral PostgreSQL service, applies all SQL migrations, and runs the CAP and authentication integration suites. Verify email deliverability, SPF, DKIM, and DMARC for the sending domain before public registration.

## Vercel Preview runtime setup

The CivicRelay Vercel project uses a separate Preview runtime configuration until the pull request is reviewed and merged.

Configured automatically for Preview:
- `DATABASE_URL`: Neon pooled connection, using the least-privilege `civicrelay_runtime` database role.
- `BETTER_AUTH_SECRET`: independently generated random secret, stored as a sensitive Vercel environment variable.
- `BETTER_AUTH_URL`: intentionally omitted on Preview. Better Auth derives its canonical origin from Vercel's deployment-specific `VERCEL_URL`.

Required before enabling real account registration:
- `RESEND_API_KEY`: a valid Resend API key, stored as a sensitive Vercel environment variable.
- `AUTH_EMAIL_FROM`: a sender identity on a domain verified in Resend, for example `CivicRelay <security@your-verified-domain.example>`.

Do not use a guessed sender domain or a placeholder API key. Registration intentionally fails closed until both Resend values exist. Add them in Vercel Project → Settings → Environment Variables, target Preview first, then redeploy the Preview deployment. Do not copy secrets into Git, issue comments, or chat.

The direct `DATABASE_URL_UNPOOLED` connection is reserved for schema migration operations and is not required by the web runtime. Keep production variables separate from Preview until a production release is explicitly approved.
