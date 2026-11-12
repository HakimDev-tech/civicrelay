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
