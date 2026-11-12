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
- Authentication is provider-agnostic at the data-model boundary: users.auth_subject stores the external identity subject; no password credentials are stored here.

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

Foundation setup. CAP ingestion, domain model, persistence, authentication, approval workflows, and public acknowledgement flows are implemented in subsequent milestones.


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
