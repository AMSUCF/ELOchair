# Working on ELOchair

ELOchair is the Electronic Literature Organization's submission and peer-review system. Its first real use is ELO 2027 (Universidad del Norte, Barranquilla). Background and decisions:
- [plan](docs/discovery/2026-11-08-discovery-and-draft-plan.md)
- [specs](docs/specs/)

This file is written for coding agents and for the people who maintain ELOchair after its first year. Follow it.

## Map

```
packages/schema   Zod schemas: the single source of truth for data shapes and conference configuration.
                  "@elochair/schema/pure" exports Zod-free helpers for browser code.
packages/policy   Who may see what: viewers, submissionAccess(), allow-list projections.
                  "@elochair/policy/testing" has findLeaks().
apps/server       Hono API, Drizzle (Postgres; PGlite in tests and development), auth, audit log, CLI, fixtures.
apps/web          Mobile-first React PWA; typed en/es/pt message catalogs; Playwright e2e tests.
deploy/           Dockerfile, docker-compose (app, Postgres, Caddy), backups, runbook.
docs/             Plan and specs.
```

## Commands

```bash
npm ci
SEED_ON_START=1 npm run dev   # API on :8080 (internal listener on :8081), PGlite database in apps/server/.data
npm run dev:web               # web app on :5173, proxies /api to :8080
npm run check                 # lint + typecheck + unit/property tests: run before every commit
npm run e2e                   # builds the web app, then runs phone-size Playwright tests with axe checks
npm run cli -- --help         # migrate, seed, import/export config, roles, agent tokens
```

In development, sign in as `chair@example.org`, `admin@example.org` or `reviewer-1@example.org`. The `elo2027-open` call is always open: its deadlines are set relative to the clock by `seedOpenCall()`. The sign-in email, with its link and 8-digit code, is printed in the server log.

Sign-in works like this:
- Each email carries a link and a code.
- The link opens a confirmation page, and nothing is used up until the person taps "Sign in".
- The code is for the installed app, and stops working after five wrong guesses.
- Tokens are stored only as hashes. Codes are stored as HMACs keyed with `SECRET_KEY`, which is kept outside the database and is required in production. The outbox redacts its copy of the email once it is sent.

## House rules

These are invariants. Do not trade them away for convenience.

1. **Data shapes start in `packages/schema`.** Change the Zod schema first, then `apps/server/src/db/schema.ts`, then run `npm run db:generate -w @elochair/server` to write a new migration. Never edit a migration that has been committed; add a new one.

2. **Visibility is decided in one place.**
   - `submissionAccess()` in `packages/policy` decides who may see a submission. Projections render it as explicit allow-lists.
   - Routes, MCP tools and exporters never return database rows or hand-assembled objects that contain person or submission data. They call a projection.
   - A new view or field needs a blindness test: fast-check properties with marker strings, checked with `findLeaks()`.

3. **Data tiers ("content stays local").**
   - **Tier M** (metadata) agent output contains no names, emails, affiliations, bios, titles, abstracts or free-text field values. It has opaque IDs, enumerations, counts and dates only, until a record is published.
   - **Tier C** (content) tokens work only on the internal listener, for local models.
   - Never add content to the metadata projection, and never accept tier C on the public listener.

4. **No third-party AI on submission content.** No calls to hosted LLM or embedding APIs with abstracts, bios, reviews or names. Computational assistance (reviewer matching, session grouping) runs on ELO's own server and returns IDs and scores. It is for chairs only, and it never writes reviews or makes decisions.

5. **People approve irreversible actions.**
   - Sending mail to participants, recording decisions and publishing follow *plan → approve*. An agent may create the plan; only a person, in the web UI, approves it.
   - Conference configuration changes are human-only.

6. **Everything is audited.** Every mutation calls `audit()`. Agent requests are audited automatically by middleware. The audit table is append-only, enforced by a database trigger.

7. **Three languages, always.**
   - Every user-visible string lives in `apps/web/src/i18n/{en,es,pt}.ts`; a missing key fails the typecheck.
   - Server emails live in `mail.ts`, in all three languages.
   - Conference configuration text must include the conference's default language.
   - The Spanish and Portuguese text was machine-drafted and is awaiting native review.

8. **Mobile-first and accessible (WCAG 2.1 AA).**
   - Touch targets are at least 44px, and nothing scrolls horizontally at 360px width.
   - Labelled form controls, live regions for status messages, and focus moves to the `h1` on navigation.
   - The e2e tests run axe; keep them green.

9. **Browser bundle.** Browser code imports runtime helpers from `@elochair/schema/pure`; import types from `@elochair/schema` with `import type`.

10. **Synthetic data only.** Test and demo data come from `apps/server/src/fixtures.ts` and use fictional people and institutions. Never commit real submissions, reviews or participant data.

## Submissions in one paragraph

Spec 02 has the details.
- **Ownership.** The person who creates a submission owns it. Only the owner edits, invites, submits, withdraws or deletes. Agents never write.
- **Writes.** Every write goes through `mutateSubmission()`, which runs one transaction that locks the row and checks the policy (`canActOnSubmission`), the call window or phase, and the version. Submitted work must stay valid.
- **Invitations.** Invitees are shown only as the owner typed them until they confirm. Inviting someone creates a conflict that outlives a decline. Declining is always possible.
- **Consent.** Consent to the conference's agreements is recorded on submit and on confirm.
- **Lists.** Lists, CSV exports and MCP tools all go through `querySubmissions()`, which projects first and filters afterwards.
- **Errors.** Routes throw `Refusal(status, code)` for deliberate refusals.

## Testing notes

- Server tests drive both listeners in-process with `app.request()` against an in-memory PGlite database. Use `apps/server/src/testkit.ts`.
- Fixtures are deterministic, shaped like ELO 2026: 200 submissions and 41 reviewers. Three fictional people deliberately exceed the presenter cap.
- `npm run e2e` uses the browsers installed for Playwright 1.63; `playwright-core` is pinned to match.
- MCP tests drive `/api/mcp` with the real SDK `Client`, whose `fetch` is pointed at `app.request`. Every tool result goes through `findLeaks()`.
- When you edit files with scripts, assert that each replacement matched. Biome reformats code, and a silent no-op edit cost an hour once.
