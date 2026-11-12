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
- npm 10+ or a compatible package manager

## Local development

    npm install
    cp .env.example .env.local
    npm run dev

Open http://localhost:3000.

Before database-backed features are enabled, set DATABASE_URL in .env.local to the Neon connection string. Never commit .env.local.

## Quality checks

    npm run lint
    npm run typecheck
    npm run build

## Project structure

    src/
      app/          App Router routes, layouts and global styles
      components/   Shared UI components
      features/     Product capabilities grouped by domain
      lib/          Shared infrastructure and utilities

## Status

Foundation setup. CAP ingestion, domain model, persistence, authentication, approval workflows, and public acknowledgement flows are implemented in subsequent milestones.
