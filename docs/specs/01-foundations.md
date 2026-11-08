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

## Status (2026-11-08)

| Item | Result |
|---|---|
| F1 Monorepo and conventions | Done. `npm run check` passes locally and in CI. The first GitHub Actions run (#1) passed every step, including the e2e tests. |
| F2 Schema | Done. `elo2026` and `elo2027` validate. 21 tests cover the configuration rules, multilingual word counts, the presenter cap, and submission validation. |
| F3 Policy | Done. 10 blindness properties at 250 runs each. While being written, they caught one real bug: a chair's tier M agent got the metadata view instead of the public view for *published* submissions. Fixed. |
| F4 Server | Done. 26 API tests cover the auth round trip, cross-origin and non-JSON rejection, tier C refused on the public listener and served on the internal one, audit rows plus the trigger, blinded reviewer views over HTTP, the cap report, and configuration validation. The production bundle was also run against a real Postgres 16. |
| F5 Web | Done. 3 Playwright tests at 390×844 (CFP → language switch → sign in → me → link reuse refused → sign out) report zero axe WCAG 2.1 A/AA violations, and there is no horizontal scrolling at 360px. JS is 88 KB gzipped. |
| F6 Deploy | Done and verified in a sandbox: the image builds, compose comes up healthy through Caddy, the internal listener is loopback-only, and backup and restore work. **Not yet verified on ELO's server**: real TLS and SMTP. |

Deviation from the original plan: the README now reflects that conference configuration lives in the database and is managed through the API and CLI (`import-config`, `export-config`). It is not stored as versioned files.

## Adversarial review (2026-11-08)

Five independent reviewers covered auth and security, blindness and policy, schema and configuration, server data and ops, and the web app. Each finding then went to a skeptic told to refute it. Of 42 candidates, **37 were confirmed** (several overlapping) and **5 refuted**. Every confirmed finding is fixed, most with a regression test.

**Sign-in**
- A request refused for its IP no longer uses up the target address's rate limit; before, one IP could silently lock anyone out.
- The limiter's sweep is bounded.
- The verify page now shows which account a link is for and waits for a tap. This stops mail scanners from using up links, and another site from signing someone into a different account. It warns when switching accounts, and network errors are no longer reported as "expired".
- Sign-in emails also carry an 8-digit code, so the installed app on iOS can finish signing in. Five wrong guesses and the code stops working.
- The stored copy of a sign-in email is redacted once sent, so tokens really exist only as hashes.

**Outbox**
- Rows are claimed atomically (`FOR UPDATE SKIP LOCKED`, plus one pass per process), so mail is never sent twice.
- Failed sends back off exponentially instead of using up every attempt in seconds.
- Expired sign-in mail is never sent late.

**Policy**
- A chair-author's tier M agent no longer sees who reviews the chair's own submission (new blindness property).
- The cap report counts only submissions the viewer may manage, and never drafts.
- The cap-report and config routes no longer reveal that a draft conference exists.

**Schema**
- Required checkboxes are enforced, and whitespace-only text counts as empty.
- The final-materials deadline must fall strictly before day one, in the conference's own time zone.
- Duplicate option keys are refused, and only IANA time-zone names are accepted.
- Regional language keys ("pt-BR") are used for the Portuguese interface.
- The 2026 workshop length (60 minutes) and team size (up to 6) now follow the 2026 schedule, and experimental sessions have no fixed length.

**Operations**
- The example password is URL-safe.
- `seed` no longer overwrites existing conferences (use `--force`), and it is audited.
- Backups are created owner-only.
- The runbook's `import-config` step pipes the file in.
- The production bundle finds its migrations on its own.
- Revoking a token twice keeps the original revocation time.
- **Caching headers were never applied** (this `serveStatic` has no `onFound` hook). They now are, and missing assets return 404 instead of the app shell. Re-verified in Docker.

**Web**
- Focus follows the page heading once data has loaded.
- Every page has its own title.
- Language is chosen with links, not a select that navigates on change.
- Fallback-language text carries `lang`.
- The submission status line names its time zone.
- Safe-area insets are respected, "1 person" is singular, and sign-out reports failures.

The refuted findings were these:
- Hyphenated words count as two, which is the specified `Intl.Segmenter` behaviour.
- The 2026 config's presenter cap, which is now documented as carried over from 2024.
- A live-region role change.
- Deep links with unsupported language prefixes.
- Remembering the language choice, which is a feature request rather than a defect.
