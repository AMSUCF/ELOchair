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
                  Styles are in src/styles: tokens first, then components (see docs/design).
deploy/           Dockerfile, docker-compose (app, Postgres, Caddy), backups, runbook.
docs/             Plan, specs, and the design notes for the ELO 2027 identity.
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
   - Conference configuration and phase changes are human-only, and for the conference's chairs. So is who holds a role: chairs invite reviewers and chairs by email on the People page, and remove roles there (see "People in one paragraph"); the `grant` command still gives any role from the server. The `chair` and `admin` roles and site admins are one group (`isConferenceChair`): a chair may do whatever an admin may, and `admin` means nothing more than `chair`. The settings screen offers the stage-one values, the review pools' and their review forms', the wording of the emails, the agreements and the invitation's texts among them; formats, fields, languages, review pools, criteria, agreements and ways to contribute are added or removed by importing a configuration. The phase is moved from "Manage submissions" (spec 02, §1.3 and §1.9). A change never makes submitted work invalid, never leaves a review that was sent outside its form, never shows a reviewer the authors of a proposal they were assigned as anonymized, and never changes what an agreement says under the version people have accepted (a changed title, text or link needs a new version; spec 02, §1.5).

6. **Everything is audited.** Every mutation calls `audit()`. Agent requests are audited automatically by middleware. The audit table is append-only, enforced by a database trigger.

7. **Three languages, always.**
   - Every user-visible string lives in `apps/web/src/i18n/{en,es,pt}.ts`; a missing key fails the typecheck.
   - Server emails are in all three languages. The sign-in email lives in `mail.ts`. The emails to the people on a proposal, and the two invitations to a role (reviewer, chair), are defined once, in `packages/schema/src/messages.ts`: their standard texts, their placeholders, and which a text must contain. A key added there appears in the settings screen's Emails section by itself; it needs its name, its "when it is sent" line and its placeholders' meanings in the three catalogs. Chairs may reword them on the settings screen, in each of the three languages whichever of them the conference has, because mail goes out in all three (spec 02, §1.9); a reader gets the conference's text in their own language or else the standard text in their own language, never another language's.
   - Values that go into an email are cleaned in `apps/server/src/templates.ts` (`sanitizeName`, `oneLine`), whatever text they go into. A new placeholder gets its value there, cleaned, and never reaches people who have agreed to nothing if an owner wrote it. An invitation to a role carries nothing a person typed at all: not the inviting chair's name, and not the name the chair typed for the invitee. One that stands for a name a person typed is listed in its message's `names`: a text must leave it a word of its own, so that no wording can build a link around it. What counts as a link or an address has one definition, `packages/schema/src/links.ts`, used by `sanitizeName` and by that rule.
   - Conference configuration text must include the conference's default language.
   - The Spanish and Portuguese text was machine-drafted and is awaiting native review.

8. **Mobile-first and accessible (WCAG 2.1 AA).**
   - Touch targets are at least 44px, and nothing scrolls horizontally at 360px width.
   - Labelled form controls, live regions for status messages, and focus moves to the `h1` on navigation.
   - The e2e tests run axe in the light and dark themes; keep them green.
   - The look follows [docs/design/visual-identity.md](docs/design/visual-identity.md). Colours, fonts and radii are tokens in `apps/web/src/styles/tokens.css`; never write them in a component.
   - Text on the forest band sits on glow fields that axe cannot measure. `apps/web/e2e/identity.spec.ts` measures them; run it before changing a `--glow-*` or `--band-*` token.
   - Motion is decoration and opt-in: put every animation or transition inside `@media (prefers-reduced-motion: no-preference)`.
   - What a page shows of a conference goes by what its configuration holds, never by its slug: a conference with an invitation gets the invitation on the front page and on its own page, and one without is shown as before (spec 02, §1.10). Only the identity goes by `dressedAs()`.
   - A deadline is shown as its call states it: the date and time as written, with the clock named (`statedDeadline` in `packages/schema`, `deadlineText` in `apps/web/src/format.ts`). Do not turn one into the conference's time zone first.
   - Fonts and images are served from the app's own origin, and never inlined as `data:` URLs (the Content-Security-Policy refuses those for fonts).

9. **Browser bundle.** Browser code imports runtime helpers from `@elochair/schema/pure`; import types from `@elochair/schema` with `import type`.

10. **Synthetic data only.** Test and demo data come from `apps/server/src/fixtures.ts` and use fictional people and institutions. Never commit real submissions, reviews or participant data.

## Submissions in one paragraph

Spec 02 has the details.
- **Ownership.** The person who creates a submission owns it. Only the owner edits, invites, submits, withdraws or deletes. Agents never write.
- **Writes.** Every write goes through `mutateSubmission()`, which runs one transaction that locks the row and checks the policy (`canActOnSubmission`), the call window or phase, and the version. Submitted work must stay valid. A settings save checks submitted work while it holds the conference's row, so any write to `submissions` or `contributions` shares that row first: `mutateSubmission()` does, and the two writes outside it (an invitation answer, creating a proposal) call `shareConference()` themselves. Lock the submission's row, then the conference's, in that order. There is one lock order for everything (spec 02, §1.9, and the comment in `apps/server/src/services/roles.ts`): the row of what is changed (a submission's or a role invitation's), then the conference's roles lock, then the conference's row, then the locks that count a day's invitations.
- **Invitations.** Invitees are shown only as the owner typed them until they confirm. Inviting someone creates a conflict that outlives a decline. Declining is always possible.
- **Consent.** Consent to the conference's agreements is recorded on submit and on confirm, against each agreement's version. The acceptance sent must name the current versions, every time.
- **Lists.** Lists, CSV exports and MCP tools all go through `querySubmissions()`, which projects first and filters afterwards.
- **Errors.** Routes throw `Refusal(status, code)` for deliberate refusals.
- **Unsaved text.** The editor, the profile form and the chairs' settings screen keep unsaved changes in the browser's `localStorage`, through `apps/web/src/unsaved.ts` and `useUnsaved`, so that a reload or a closed tab does not lose them. The server stays the source of truth and saving stays explicit. Buffers are kept under the signed-in person's id; they go on save, discard, delete, withdraw and sign-out, and after 30 days. A person's sign-out ends that person's buffers in every open tab, and nobody else's, through a random token kept in the store for each person: a form opens under the token it finds (or makes one), reads it before and after each write, and writes only while the store still holds that very token; a sign-out puts a new one in its place. No clock takes part in that, and the only token ever written is a new one: never write an existing token back, not even to change its time, or a write could undo a sign-out. The token holds an id, random digits and a time, no text, and goes 30 days after it was made unless that person still has unsaved text in that browser; its going can only stop a form. The profile has no versions, so each of its changes is kept with the saved value it was made on: a change whose saved value has changed since is offered as a choice, never laid over the newer text. What comes back is checked against the form as it is now (`unsavedProposal.ts`, `settingsEdits.ts`): a value for a field, a language or a setting that is gone, for a control the editor does not show as the conference is now (`showsControl`), or of the wrong kind, is left out and never sent. A new form that holds real writing uses the same module. Never keep there what the server sent about other people.

## People in one paragraph

Spec 03, §1.2 has the details.
- **The page.** `/:lang/c/:slug/people` is for a conference's chairs, in person (`chairInPerson`, `canManagePeople`): an agent is refused whatever its tier. It lists chairs, reviewers by pool, existing track chairs (removable, never added) and the invitations nobody accepted. It is rendered by `projectPeople()` in `packages/policy`.
- **Words.** A review pool is a "committee" wherever a person reads it on the People page, the invitation page and in the emails; it stays a pool in code, in the API and on the settings screen.
- **Shown as typed.** Someone who holds a role is shown by their profile. An invitation that was not accepted is shown only as the chair typed it, never from the invitee's profile, so the page is the same whether or not the address has an account.
- **Invitations.** Tables `role_invitations` and `role_invitation_sends` (the ledger for the daily limits, which cancelling does not empty). The link's token is stored only as a hash, works once and for 30 days, and is removed from the stored mail once sent. The numbers are in `ROLE_INVITATIONS` (`packages/schema`).
- **The role is bound to the address.** Accepting by link gives the role to the person the invitation was addressed to, whoever opens the link, and signs nobody in. The answer's input is strict: nothing in it can name a person, a role or a pool.
- **A reviewer's pools** are the scope of their `reviewer` role, which is what `submissionAccess()` reads; `reviewer_profiles` holds what they said on accepting. No scope means every pool, so the reviewer's role is never given without one.
- **Counts.** A reviewer's "proposals assigned" and "reviews sent" count only the proposals the chair looking manages (`assignedCount`, `sentCount`): a chair may not learn from a number who reviews their own proposal, or that it has been reviewed.
- **Removing.** A reviewer's removal releases their assignments (reason `role_removed`; see "Assignments in one paragraph") and deletes their reviewer profile in the same transaction. A review they sent stays, with the assignment it belongs to; their drafts go with the assignments that are released (see "Reviews in one paragraph"). The request names both numbers the confirmation showed. A chair cannot remove their own chair role. Accepting and removing take the conference's roles lock exclusive and read who holds what under it.
- **A chair removed meanwhile changes nothing.** A route's check of who is asking comes before its transaction. Every write that is allowed because the caller chairs the conference (a configuration save, a phase move, inviting, sending again, cancelling and removing on the People page, and assigning or releasing a reviewer) therefore calls `stillChair()` inside its transaction: it shares the roles lock and reads the chair again, and is refused with 403 if the role is gone. A new chair-only write does the same, before it takes the conference's row. Reads, the CSV exports among them, are checked once.
- **Ids from an address** are lower-cased before use (`idParam`), and a check on whose row it is reads the row: Postgres takes an id in capitals for the same id, and text comparison does not.

## Assignments in one paragraph

Spec 03, §1.3 has the details.
- **Who.** A chair of the conference, in person, by hand, on the proposal's page; never an agent or a track chair, and never for the chair's own proposal or one they have a conflict with. One rule says so, `canManageReviewers()` in `packages/policy` (a chair who is given the proposal as a chair), and every route and view about a proposal's reviewers goes through it. For a proposal a chair does not manage the answer is 404.
- **When.** A proposal takes a reviewer while its status is `submitted` (`underConsideration`), once the call has closed (`callState`). A reviewer reads what is assigned to them once the conference is in `reviewing` or a later phase (`reviewersCanRead`; the policy is given the phase as `SubmissionContext.phase`). Before that they get what a stranger gets.
- **Who is offered** is decided in the policy (`reviewerOffer`): the reviewers of the format's pool, without the proposal's own people, anyone with a conflict, anyone released from it because of a conflict, and anyone already on it. The server refuses whoever is not offered, with one answer for every reason. A reviewer who has reached the number they said they would take is offered last and assigned only once the chair has been told (`confirmedFull`). A load is always `assignedCount()`, as the chair looking may know it; a withdrawn proposal is not counted. Someone assigned who can no longer review a proposal (`couldReview`: now one of its people, a conflict, another pool) is shown as such and not counted among its reviewers.
- **The format stays.** A proposal that has had a reviewer keeps its format, a draft too (`everHadReviewer` in the owner's edit): the format decides what its reviewers are shown.
- **Released means gone.** `assignments` holds the assignments that stand, and nothing else: whatever reads it, in this version of the app or an earlier one, reads the ones that count. Removing a reviewer from a proposal deletes the row and writes the record of it to `assignment_releases` in the same transaction; one function does it (`releaseAssignments` in `services/assignments.ts`), for a chair's removal and for a role's. Assigned again, the reviewer gets a new assignment. Never put a "released" mark on `assignments`: an older version of the app would read such a row as an assignment.
- **The record of releases** is read only in `services/assignments.ts`, for four things. Three are ids: who left a proposal because of a conflict (never offered for it again), which proposals have ever had a reviewer (`everAssigned`: the guard on anonymity in `services/settings.ts` counts them on purpose, so that releasing a proposal's reviewers cannot be the way to show them its authors), and whether one proposal has (`everHadReviewer`). The fourth is for a chair who manages the proposal, on its page: who said they could not review it, with their reason and their note. It goes with its proposal and outlives the people it names (their ids become null).
- **Views.** The Reviewers section of a proposal's page is `projectProposalReviewers()`, and `/:lang/c/:slug/assignments` is `projectAssignments()`, paged pool by pool with a sealed position. Both are for a chair in person, and say "committee" for a pool.
- **Locks.** Assigning and releasing take the proposal's row (for no key update, so that a foreign key's check passes it: `services/roles.ts` says why), then the roles lock shared (`stillChair`), then the conference's row shared (`shareConference`), in the one order of `services/roles.ts`. That is what makes two chairs' assignments of one reviewer one assignment, keeps anyone who is not a reviewer from holding one, and makes a settings save wait.
- **Audit.** `assignment.made` and `assignment.released`, on the submission, with the reviewer's id and the reason. Nobody is emailed yet.

## Reviews in one paragraph

Spec 03, §1.4, §1.5 and §1.8 have the details.
- **Who writes.** The person `submissionAccess()` gives a reviewer's view of the proposal, in person, and only while the conference is in `reviewing` (`canWriteReview` in `packages/policy`). Everyone else gets what a missing proposal gets (404); an agent is refused whatever its tier. In a later phase reviews are read, not written (409 `not_reviewing`).
- **A chair who also reviews** is given an assigned proposal as a chair, and is its reviewer all the same (`isReviewerOf`: never ask whether the access string starts with `reviewer_`). Their review is on the chair's page of the proposal, above its reviewers. Never their own proposal or a conflict.
- **A draft, then sent.** A draft is its reviewer's own: nothing a chair can read says that one exists, so the chairs' views, their counts and the guard on the settings are handed sent reviews only (`loadSentReviews`). Once sent, a review stays sent: it is changed by sending it again, complete, and a save names the version it was made on (409 `stale`).
- **The form is the committee's**, read from the configuration (`reviewPools[].form`, a criterion's `description`, `deadlines.reviewsDue`): every limit and every description on it is a setting, and the screens show the standard wording (the web catalogs) until a chair writes their own. One definition says what keeps a review from being sent (`reviewIssues` in `packages/schema/src/reviewForm.ts`), for the page, the server and the guard on the settings.
- **A review belongs to a proposal and a reviewer**, not to a row of `assignments`, which is deleted on release. `releaseAssignments` keeps the two tables in step: a release takes the reviewer's draft with it, and an assignment whose review was sent is never released. So a chair does not remove a reviewer whose review is sent (409 `review_sent`), that reviewer does not give the proposal back, and removing their role keeps the review and its assignment.
- **"I cannot review this"** releases the reviewer's own assignment through `releaseAssignments`, with their reason and a note for the chairs, and for a conflict records one (`conflicts`), so that the policy never gives them the proposal again.
- **Who reads.** A reviewer reads their own review (`projectOwnReview`) and their own list (`projectMyReviews`), and nothing of anyone else's: not who else reviews, not what they wrote, not what was decided. A chair reads a sent review, with who wrote it, in the Reviewers section of a proposal they manage (`projectProposalReviewers`): never for their own proposal or one they have a conflict with. Authors are shown nothing yet, and agents nothing, whatever their tier.
- **Sent reviews stay valid.** A settings save that would leave a sent review outside its form is refused at the value that would do it, with how many reviews (`reviewsOutsideForm` in `services/settings.ts`; spec 02, §1.9). The reviews of a chair's own proposal, or of one they have a conflict with, are kept from that chair (`reviewsKeptFrom`) and not read for this at all, neither what they hold nor whether there are any. What is decided for that chair is decided without them: once the conference is in `reviewing` or a later phase, narrowing the form of the committee that reviews such a proposal, if it was ever submitted, is refused to them (`reviews_hidden`), and another chair makes the change. Otherwise a chair could read their own scores, or that they have been reviewed, from what is refused. Anything new that is worked out for a chair from the conference's reviews leaves those reviews out in the same way, before it looks at any.
- **Locks.** A review's write and "I cannot review this" take the proposal's row (for no key update), the roles lock shared (with the reviewer read again under it), then the conference's row shared, in the one order of `services/roles.ts`. That is what makes a chair's removal, a role's removal, a settings save and a phase move wait for a review that is being sent, and the other way round.
- **Audit.** `review.draft_saved`, `review.sent`, `review.changed` and `conflict.declared`, on the submission, with ids and a version. Never a score, a recommendation or a word of a review or of a note. Nobody is emailed yet.

## Deploying to jtm.io

Production (and the `elo27.jtm.io` eval instance) runs on jtm.io under a dedicated, unprivileged `elochair` system account — not under any other account on that host. If you don't have SSH access as `elochair`, use the static-preview path below instead of asking for it.

**For a UI prototype or design study (no SSH needed, no app changes):**
Put self-contained static files in `docs/design/visitor-preview/` (the exact file list is hardcoded in `deploy/preview.sh`'s `preview_files` array, so add new filenames there if you add files). Pushing to `main` with changes under `docs/design/visitor-preview/**`, `deploy/preview.sh`, or the workflow file auto-deploys via the **Deploy design preview** GitHub Actions workflow; it can also be run manually from the Actions tab (`workflow_dispatch`, exists on `main` only). It uploads just those files to a directory the production nginx serves directly, with no app rebuild: **https://elo27.jtm.io/elochair-design-preview/**, gated by HTTP Basic Auth at the nginx level (ask for the current credentials — don't put them in the repo or workflow). See `deploy/preview.md`. This is the right tool for "I want to show someone a prototype" — don't touch the real app for that.

**For real app changes (needs SSH as `elochair`):**
- Repo lives at `~/elochair` on jtm.io. **TODO once this branch is actually deployed:** confirm and record here which branch `git branch --show-current` reports there — as of this branch's creation, production was tracking `ccr-e6ee03db-qhfk2z` (not `main`), and this note needs updating the moment that changes. Don't assume `main` (or this branch) is live without checking.
- Rebuild/redeploy: `cd ~/elochair/deploy && git pull --ff-only origin <branch> && docker compose -f docker-compose.yml -f docker-compose.local-test.yml up -d --build app backup && docker compose -f docker-compose.yml -f docker-compose.local-test.yml restart backup`
- **Name the services every time: `app` and `backup`, and never a bare `docker compose up -d`.** A bare `up -d` will also try to start the compose file's `caddy` service, which fights with the host's own nginx for ports 80/443 and fails. nginx (not the in-stack Caddy) already terminates TLS for this deployment.
- **`backup` takes the hourly database dumps (see "Backups" in `deploy/README.md`), and nothing depends on it, so it runs only if it is named.** An installation that was running before the service existed has to start it once, by name, after pulling the change that adds it: until then there are no backups at all. The `restart` is there because the backup scripts are mounted into the container, which goes on running the old ones until it is restarted.
- After every deploy, check that backups are being taken; both must say so before you leave:
  - `docker compose -f docker-compose.yml -f docker-compose.local-test.yml ps backup` shows the service `Up` and, once the first dump is written, `healthy`;
  - `docker compose -f docker-compose.yml -f docker-compose.local-test.yml run --rm backup healthy` prints the newest dump and its age, and fails if there is none or it is too old.
- Pushing to `main` is also meant to trigger an auto-deploy webhook (`deploy-webhook` pm2 process on the server, scoped to `up -d --build app` only) — as of 2026-11-16 this hasn't been confirmed working end-to-end, so don't rely on it; deploy manually over SSH until it's verified. It does not start or restart `backup`: after it has run, do that by hand and make the two checks above.
- The `elochair` account has no sudo and is in the `docker` group only. It can fully manage the app/db containers but nothing else on the host.

## Testing notes

- Server tests drive both listeners in-process with `app.request()` against an in-memory PGlite database. Use `apps/server/src/testkit.ts`.
- Fixtures are deterministic, shaped like ELO 2026: 200 submissions and 41 reviewers. Three fictional people deliberately exceed the presenter cap.
- Server tests that need an open call use `seedTestCall()`, which opens the made-up call in `apps/server/src/fixture-call.ts`; one that needs any valid configuration uses `fixtureCall`. Never build a test on what a real conference's configuration says (the formats, limits, fields or agreements of `conferences.elo2027`): it changes whenever the organisers decide something. What ELO 2027's call says is recorded in one place, `packages/schema/src/elo2027.test.ts`. A real configuration may still be used whole where its content does not matter to the test: that it parses, that `seed` installs it, as a draft conference to keep hidden, and in the property tests that run over every configuration. Development and the e2e tests use `seedOpenCall()`, which is ELO 2027's own configuration on dates that follow the clock. A browser test that reads what that call says (its invitation, its ways to contribute) takes it from `/api/conferences/elo2027-open` and holds the page to it.
- `npm run e2e` uses the browsers installed for Playwright 1.63; `playwright-core` is pinned to match.
- MCP tests drive `/api/mcp` with the real SDK `Client`, whose `fetch` is pointed at `app.request`. Every tool result goes through `findLeaks()`.
- The in-memory database runs one transaction at a time. What must hold when requests run at once (the invitation limits, one answer per link, two chairs removing each other, two chairs assigning one reviewer, a reviewer removed while being assigned, a review sent while its reviewer is removed or while the settings narrow its scale, two saves of one review) is tested against a real Postgres when `TEST_DATABASE_URL` is set: the last part of `apps/server/src/people.test.ts`, of `assignments.test.ts`, of `reviews.test.ts` and of `settings-locks.test.ts`, each of which says how to start one. Run each of those files on its own against it.
- The browser tests sign in sparingly: the server allows 30 sign-in requests per address in 15 minutes, and the suite runs beside itself on one server. A test that needs a chair goes in `apps/web/e2e/settings.spec.ts`, which has one signed in for the whole file (that chair chairs the sandbox too); answering an invitation by its link needs no sign-in.
- Other browser tests read the sandbox's assignments (reviewer-1's and reviewer-30's, and that its anonymized formats have reviewers). A test that assigns there takes a proposal and a reviewer by a rule that keeps clear of those, and removes only what it assigned.
- Reviewer-30 writes on the sandbox, in `apps/web/e2e/review.spec.ts`: reviews of their own proposals, one of which they give back. The rule that says which proposals is at the top of that file. Whatever else compares the sandbox's Assignments list leaves out the proposals reviewer-30 reviewed when it began, and holds a page to the answer the page itself was given.
- The sandbox stays in `reviewing` while the tests run: reviews are written only in that phase. No test moves its phase. The phase control is tried on `phase-room`, an empty conference seeded in review for that (`seedPhaseRoom`).
- A chair who also reviews is tried on `chair-reviews`, a small conference seeded in review where the sandbox's chair holds both roles and has three talks assigned (`seedChairReviews`). So that chair is offered "My reviews" everywhere; that someone who reviews nowhere is not offered it is checked with the author in `settings.spec.ts`.
- When you edit files with scripts, assert that each replacement matched. Biome reformats code, and a silent no-op edit cost an hour once.
- The standard wording of the emails to participants is pinned. `MESSAGES_BEFORE` (`@elochair/schema/testing`) holds what each email said, for every message and language, and a schema test and a server test compare with it. Change a standard text and its captured cases in the same commit, and only on purpose.
- Write invisible characters (zero-width, bidi, BOM, tag characters) as escapes such as `\u200B` or `\u{E007F}`, never literally. Some editing tools decode escapes into the real characters, so check changed files for them before committing.
- Invisible characters in short text have one definition, `packages/schema/src/invisible.ts`. It is used by `OneLine`, by mail cleanup and by the browser.
