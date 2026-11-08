# Spec 01: Foundations

**Phase:** Foundations (plan §9, Nov 9 – Nov 22, 2026)
**Inputs:** [discovery plan](../discovery/2026-11-08-discovery-and-draft-plan.md). Every default in §8 of the plan was accepted on 2026-11-08.

The goal is to lay down the parts every later phase builds on, so the Submission MVP (spec 02) only adds features.

## In scope

### F1. Monorepo and conventions

- npm workspaces, TypeScript (strict), Biome for lint and format, Vitest.
- One command checks everything: `npm run check` (lint, typecheck, test).
- `AGENTS.md` (read by coding agents; `CLAUDE.md` points to it) states the house rules:
  - Data shapes are defined in `packages/schema` first.
  - Routes never return database rows; they return projections from `packages/policy`.
  - Irreversible actions follow a _plan → human approve_ pattern.
  - Every user-visible string exists in en, es and pt.
- A GitHub Actions workflow runs the check, the web build, and the end-to-end smoke test.

**Accept when:** a fresh clone passes `npm ci && npm run check`, and CI is green.

### F2. `packages/schema`, the single source of truth

- Zod schemas for:
  - the conference configuration: languages, time zone, deadlines, tracks, topics, review pools (blind mode, reviews per submission, criteria), submission types (word limits, duration, team size, pool, custom fields with an `identifying` flag), and the presenter-cap rule
  - the domain records: person, submission, contribution, reviewer profile, conflict, assignment
- Cross-field validation:
  - a type's pool must exist
  - localized text must include the default language
  - keys must be unique
  - min ≤ max
  - deadlines must be in order
- Utilities:
  - multilingual word counting (via `Intl.Segmenter`)
  - the presenter-cap report (counts counted roles in counted types, and lists who is over the cap)
- Two real configurations:
  - `elo2026`: a faithful encoding of the 2026 CFP, including what 2026 actually did (performance statements were anonymized)
  - `elo2027`: a **placeholder draft** with es/en/pt labels using the accepted defaults. Its dates and types are placeholders until the Barranquilla CFP arrives, and its translations are machine-drafted and need review by the 2027 team.

**Accept when:** both configurations validate, and invalid configurations are rejected with path-specific errors (covered by tests).

### F3. `packages/policy`: roles, data tiers and projections

- **Viewers:**
  - the public
  - a person (human session) with per-conference role grants: `admin`, `chair`, `track_chair` (scoped to tracks), `reviewer` (scoped to pools)
  - an agent token, tier **M** or **C**, acting for a person
- **Projections:** one function per record kind decides what a viewer may see.
  - _Contributor rule:_ a contributor to a submission always gets the submitter view of it, whatever other roles they hold.
  - _Conflict rule:_ a conflicted reviewer or chair gets nothing beyond what the public sees.
  - _Reviewer rule:_ only assigned reviewers see a submission.
    - **double-blind:** no names, affiliations, bios, emails, or `identifying` field values
    - **single-blind:** names and affiliations, but no bios or emails
    - **open:** names, affiliations and bios, but no emails
  - _Tier M rule:_ opaque IDs, enumerations, counts and dates only. No titles, abstracts, names, emails, bios, or free-text field values.
  - _Tier C rule:_ the same view as the token's owner.
  - _Published rule:_ published submissions expose their public fields to everyone.
- **Blindness test suite:** property-based tests (fast-check) generate random people and submissions with distinctive marker strings. They serialize every projection for every viewer kind and assert that no forbidden marker appears.

**Accept when:** the blindness suite passes across at least 200 generated cases per property.

### F4. `apps/server`

- Hono on Node.
- Drizzle ORM on Postgres in production, and PGlite (Postgres in WASM) for tests and zero-setup local development.
- SQL migrations are committed.
- **Two listeners:**
  - The **public** listener, which sits behind TLS, _refuses tier C tokens_.
  - The **internal** listener is bound to loopback or the private Docker network. It is the only place tier C tokens work: the on-server model worker uses it, and chairs reach it over an SSH tunnel. This is the technical half of "content stays local"; the other half is policy plus the audit trail.
- **Magic-link authentication:**
  - The request endpoint always answers 202, so it cannot be used to discover accounts, and it is rate-limited per email and per IP.
  - Tokens are 32 random bytes, stored only as a SHA-256 hash, single-use, and valid for 20 minutes.
  - The link carries the token in the URL fragment. The web app POSTs it to the server, so it never appears in server logs or referrers, and email link scanners cannot use it up.
  - Sessions use HttpOnly SameSite=Lax cookies, stored hashed, and last 14 days.
  - State-changing requests must come from the app's origin and carry a JSON content type.
- **Mail:** all mail goes through an outbox table. Transports: `log` (development), `memory` (tests), `smtp` (production, via nodemailer).
- **Audit log:** append-only, enforced by a database trigger. It records human mutations and every agent request, including the token ID and tier.
- **API:**
  - `GET /healthz`
  - auth: request link, verify, logout, `me`
  - list conferences; public conference configuration
  - admin-only configuration update (validated, audited)
  - projected submissions list
- **CLI** (usable by humans and agents): `migrate`, `seed`, `import-config`, `grant`, `create-token`, `revoke-token`.
- **Fixtures:** a deterministic synthetic set shaped like ELO 2026:
  - 200 submissions, split across types in the same proportions as the 108 scheduled 2026 events plus 47 exhibition works
  - 41 reviewers, about 25% of whom also submit
  - people who exceed the presenter cap
  - **fictional names and institutions only**: no real ELO participant data is used

**Accept when:** the API tests cover the full auth round trip, cross-origin rejection, tier enforcement on both listeners, audit rows for agent reads, and projection output for each viewer kind.

### F5. `apps/web`, the mobile-first PWA shell

- React and Vite.
- Typed message catalogs for en, es and pt; a missing key fails the typecheck.
- Language detection plus a language switcher.
- **Pages:**
  - conference list
  - CFP view rendered from the configuration (types, limits, durations, deadlines shown in both the conference's and the viewer's time zone)
  - sign in
  - verify
  - "me"
- A web app manifest, light and dark themes, 44px touch targets, and no horizontal scrolling at 360px.
- The server serves the built app in production.

**Accept when:** a Playwright smoke test at a 390×844 viewport completes CFP view → sign in → magic link → "me", and `axe-core` reports no WCAG 2.1 A/AA violations on those pages.

### F6. Deployment for ELO's servers

- A multi-stage `Dockerfile`.
- `docker-compose.yml` with:
  - the app (public listener published through Caddy, internal listener left unpublished)
  - Postgres 16 with a volume
  - Caddy with automatic TLS
- `.env.example`.
- A backup script (pg_dump with rotation) and a restore runbook.

**Accept when:** the image builds, and `docker compose up` serves `/healthz`. If Docker is not available where this is built, this will be reported as not verified.

## Out of scope (later specs)

- Submission forms and editing, co-author invites, self-identification warnings (spec 02, Submission MVP)
- The MCP endpoint itself (spec 02 adds read-only tier M; the projections it will use are built here)
- Reviews, decisions, notifications, scheduling, exports
- The `local-ai` embedding worker (review setup phase)

## Blocked on external input (not blocking this phase)

- **The ELO 2027 CFP** (types, dates, languages, modality) from the Barranquilla team. Until then, `elo2027` stays a placeholder.
- **Access to ELO's server and DNS/SMTP for eliterature.org.** Until then, deployment is verified locally only.
