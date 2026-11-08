# Spec 02: Submission MVP

**Phase:** Submission MVP (plan §9: Nov 23 – Dec 20, 2026). The portal opens in January 2027.
**Builds on:** [spec 01](01-foundations.md). It follows the house rules in [AGENTS.md](../../AGENTS.md) throughout.
**Revision 2:** three independent critics reviewed the first draft before any routes were built (security and privacy, ELO process and UX, maintainability and agents). This version adopts their findings; [Deferred](#deferred) lists what was set aside and why.

The goal is to open a call for proposals that people can submit to from a phone, in English, Spanish or Portuguese. Chairs can follow along, and so can their agents, without seeing anything the policy hides, and without the system becoming a way to probe, spam or impersonate people.

## 1. Rules

### 1.1 Who can do what
- **The owner** is the person who creates a submission (`submissions.owner_person_id`). The owner cannot be changed in this phase.
  - Only the owner edits content, manages co-authors, submits, returns to draft, withdraws and deletes drafts.
  - Edit rights never depend on the program role. The owner picks their own role (lead, presenter, co-author, panelist, moderator), so someone filing for a panel they will only moderate is not counted as a presenter.
  - The owner's contribution row cannot be removed; its role and position can change.
- **Co-authors** are invited by email with a role. That role excludes `lead`: there is exactly one lead, chosen by the owner, either themselves or a confirmed co-author.
  - **Invited co-authors** can see the submission and confirm or decline.
  - **Confirmed co-authors** can see it and leave it.
  - Neither can edit.
- **Agents never change submissions.** Write routes answer 403 `agents_read_only` before any other check.
- **The decision lives in `packages/policy`** (`canActOnSubmission`). Routes ask the policy; they do not decide.

### 1.2 Invitations protect the invitee
- The invitation stores what the owner typed: `invited_email`, plus optionally `invited_name`, `invited_affiliation` and `invited_lang`.
  - Nothing the owner types is ever written to `people`.
  - Until the invitee confirms, every view renders that contributor from the invitation fields only, never from their profile. Answers are therefore identical whether or not the address already has an account.
- **Inviting creates a conflict** (`kind: coauthor, declared_by: system`) between the invitee and the submission. It survives declining or leaving, so someone who has seen the full submission can never be assigned to review it.
- **Declining or leaving** sets status `declined`; the row is kept as evidence.
  - Declined contributors disappear from every view except the chair view, and from team counts and the presenter cap.
  - Declining is always allowed, even after the deadline, because a person must always be able to refuse authorship.
  - The owner is emailed whenever someone confirms, declines or leaves.
- **Single-blind, open and public views list only confirmed contributors.** An unconfirmed name is never shown to reviewers.
- **Limits:**
  - 20 invitations per owner per day, and 5 per recipient address per day across all owners.
  - Pending plus confirmed contributors may not exceed the type's `team.max`.
  - Someone who declined cannot be re-invited to the same submission.
  - Resending is limited to once an hour per invitation.
- **The invitation email** is fixed text in the invitee's language:
  - It contains the owner's display name (one line, with links removed), the conference title, the format, the role, and a link.
  - It contains no submission title, no abstract, and no name the owner typed for the invitee. ELO's signed mail must not carry text an attacker wrote.
- **The invitation link** carries a single-use token, stored only as a hash. It expires at `submissionsClose` or after 14 days, whichever is later; declining stays possible after the close.
  - It opens `/:lang/invitation#token`. That page shows the conference, the format, the title, the owner, the role, and what the role means for the presenter cap.
  - **Decline** needs no account.
  - **Confirm** needs the agreements to be acknowledged (§1.5). It does not sign the person in; it offers sign-in afterwards to complete a profile.

### 1.3 Lifecycle and deadlines
- `draft → submitted ⇄ draft` (return to draft, before the close) `→ withdrawn` (final).
- Drafts are created only by an explicit **Start**, after a format and abstract language are chosen.
- Drafts can be deleted outright: a hard delete by the owner. The audit row keeps IDs only, and pending invitees are told.
- **The call is open** when the phase is `cfp_open` and the server's receipt time `t` satisfies `submissionsOpen ≤ t < submissionsClose` (`isCallOpen`). There is no grace period, and the client clock never decides anything.
  - Create, edit, invite, remove, return to draft, submit and delete need an open call.
  - **Withdraw** (from `submitted` only) is allowed in phases `cfp_open`, `reviewing` and `deciding`, whether or not the call is open. Withdrawal mail goes to every contributor and to `contactEmail`.
  - **Confirm** needs an open call. **Decline and leave** are always allowed.
- **Submitted work stays valid.** A submitted submission always passes `validateSubmission`.
  - An edit or co-author change that would break this returns 422 `issues` and saves nothing.
  - To make bigger changes (swap a full panel, change format), return to draft, edit, and submit again before the close.
  - A decline after the close can still invalidate a submission. Its metadata then carries `issueCodes`, and chairs see it as **incomplete**.
- **Concurrency.**
  - Every submission has an integer `version`. Writes must send the version they edited; a stale one gets 409 `stale`.
  - Each mutation runs in one transaction that locks the submission row and uses one `now` for the whole request.
  - Submit is `UPDATE … WHERE status = 'draft'`: mail goes out only if a row changed, so a double tap on a phone sends one receipt.
- **Phases** move forward only, except `draft ⇄ cfp_open`. Any other move needs `--force` and a reason. Every move is audited (the API or CLI user, from, to, reason).
- **Visibility.** The policy treats a submission that was never submitted (`submittedAt` null) like a draft, whatever its status. Contributors only.

### 1.4 What each person learns
- **Presenter cap.** People are told about their own counts only.
  - `/check` and the submit response report only the requesting person's count, as `{ count, max }`.
  - The invitation page tells the invitee what confirming would do to their own count.
  - Only chairs see everyone's counts. The cap report counts **confirmed** contributions only, and lists pending invitations separately as a number.
  - The wording comes from the configuration: "This conference programs at most {max} first-author or presenting roles per person ({types} do not count). You have {n} in submitted proposals."
- **Self-identification checks** run live in the browser on the owner's own data, as names, affiliations and emails the owner can already see. The server check (`/check`, submit) is authoritative and adds ORCID iDs and email domains.
  - The server returns `{ path, kind }` only. Chairs and agents see counts.
  - Reviewers never receive findings or contributor person IDs.
- **`/check`** is for human sessions with `submitter` or `chair` access. It is built by `projectCheck()` in `packages/policy`, not hand-assembled. Agents get 403; reviewers and strangers get 404.
- **Audit details** hold IDs, enum values and the names of changed keys only, never field values, emails or names. The audit log cannot be redacted, so it must never hold content.

### 1.5 Agreements (consent)
- Each conference's configuration lists `agreements`: privacy notice, code of conduct, and recordings policy. Each is localized, versioned, and has a link or text.
- The owner must acknowledge the current versions to submit; an invitee must acknowledge them to confirm.
- Acknowledgments are stored as `{person, conference, key, version, at}` and audited. This is the "prior, express authorization" Colombia's Ley 1581 requires before processing personal data.
- ELO 2027's agreements are placeholders until ELO's actual policy texts are supplied.

### 1.6 Profiles
- `PUT /api/me/profile` takes a strict object: `displayName` (required to submit, 1–200 characters, one line), `affiliation`, `country`, `languages`, `pronouns`, `orcid` (shown as self-declared), and `bios` (per language).
  - Any other key, including `email` or `id`, gets 400. Changing your email is not possible in this phase.
- Bios are stored per language (`bios: { en, es, … }`) and kept on the person, never on the submission.
  - The configuration says whether a bio is requested and how long it may be (`rules.bio`).
  - A missing requested bio is a warning, not a block.
- The chair view and CSV include pronouns.

### 1.7 What ELO's formats need now
- **`participationMode`** (`in_person`, `online` or `undecided`) is a core submission field. It is required when the conference is hybrid, and it is visible to tier M as an enumeration.
- **`language`** is the language of the abstract, one of the conference's languages.
- **Panels** get one session abstract. Per-paper panel abstracts (2022, 2025) depend on the Barranquilla CFP; see Deferred.

## 2. Contracts

### 2.1 One query, one shape
- **`SubmissionQuery`** (Zod, `packages/schema`) is used by the REST list, both CSVs and the MCP tools:
  - filters: `status[]`, `type`, `track`, `language`, `participationMode`
  - booleans: `hasSelfIdWarnings`, `hasPendingInvitations`, `incomplete`
  - `q`, a title search
  - paging: `cursor` and `limit`
- **`querySubmissions(viewer, conference, query)`**, on the server:
  - projects every record first, then filters only on projected fields, ordered by `(createdAt, id)`
  - returns `{ items, total, excludedCount, nextCursor }`
  - when the viewer cannot see titles, `q` gets 400 `q_not_allowed`
- **Errors:**

  | Situation | Status | Body |
  |---|---|---|
  | Invisible or missing | 404 | `not_found` |
  | Malformed input | 400 | `invalid` with `{path, message}` |
  | Breaks a submission rule | 422 | `{ error: "invalid", issues: SubmissionIssue[] }` |
  | Call closed or wrong phase | 409 | `call_closed` |
  | Stale version | 409 | `stale` |
  | Agent on a write route | 403 | `agents_read_only` |
  | Over a limit | 429 | `rate_limited`, audited |

### 2.2 Routes

| Route | Who | Notes |
|---|---|---|
| `POST /api/conferences/:slug/submissions` | signed-in person | `{typeKey, language, ownRole}`; owner is confirmed |
| `GET /api/submissions/:id` | per policy | projection |
| `GET /api/submissions/:id/check` | submitter or chair (human) | `projectCheck()` |
| `PATCH /api/submissions/:id` | owner, open call | `{version, …content}`; type change only while a draft; 422 if it would invalidate submitted work |
| `DELETE /api/submissions/:id` | owner, draft, open call | hard delete; invitees told |
| `POST /api/submissions/:id/submit` | owner, open call | `{version, acceptedAgreements}`; mail to contributors |
| `POST /api/submissions/:id/unsubmit` | owner, open call | back to draft |
| `POST /api/submissions/:id/withdraw` | owner | submitted only; phases cfp_open, reviewing, deciding |
| `POST /api/submissions/:id/contributors` | owner, open call | invite `{version, email, role, name?, affiliation?, lang}` |
| `PATCH /api/submissions/:id/contributors/:personId` | owner, open call | `{version, role?, position?}` |
| `DELETE /api/submissions/:id/contributors/:personId` | owner, open call | not the owner |
| `POST /api/submissions/:id/contributors/:personId/resend` | owner, open call | once an hour |
| `POST /api/submissions/:id/leave` | confirmed contributor (not owner) | always |
| `POST /api/invitations/info` | holder of an invitation token | details for the invitation page |
| `POST /api/invitations/answer` | holder of an invitation token | `{token, answer, acceptedAgreements?}` |
| `GET /api/me/submissions` | person | with conference, deadline, own cap count |
| `GET /api/me/invitations` | person | pending invitations (also answerable while signed in) |
| `POST /api/me/invitations/:submissionId/answer` | person | same as above, by session |
| `PUT /api/me/profile` | person | strict |
| `PUT /api/conferences/:slug/phase` | admin (human) | forward only unless `force` + `reason` |
| `GET /api/conferences/:slug/submissions` | per policy | `SubmissionQuery` |
| `GET /api/conferences/:slug/submissions.csv` and `contributors.csv` | chair (human), or tier C on internal | §2.3 |

Write routes have a 64 KB body limit and 60 writes a minute per person. Input schemas cap characters: title 300, abstract 8 × maxWords, each field 10,000.

### 2.3 CSV exports
- **Rows:** only submissions where `submissionAccess(person, r) === "chair"` (so a chair's own and conflicted submissions are left out). The response says how many were omitted. List filters apply.
- **`submissions.csv`**, one row per submission:
  - reference, id, status, type (key and label), track, topics, language, participationMode
  - title, abstract, abstract words
  - created, submitted and updated times (ISO 8601 in the conference time zone)
  - contributors (`Name <email> (role, status)` joined with `; `)
  - pending invitations, issue codes, self-identification warning count, over-cap flag
  - one `<type>.<field>` column per custom field
- **`contributors.csv`**, one row per contribution: reference, position, role, status, name, email, affiliation, country, pronouns, has-bio.
- **Format:**
  - UTF-8 with a BOM, every cell quoted (RFC 4180)
  - any cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`
  - `Content-Disposition: attachment` and `Cache-Control: no-store`
  - each export is audited (`submissions.exported`, with kind, row count and filters)

### 2.4 MCP (read-only)
- **Endpoint:** `/api/mcp`, so it inherits the token resolution, tier C refusal on the public listener and agent audit of `/api/*`. Cookie sessions get 401. Transport is Streamable HTTP, stateless, with JSON responses.
- Only read tools are registered. Each tool call writes one `agent.mcp_tool` audit row containing the tool name and its validated enum and ID arguments.
- Each tool calls the same service function as its REST counterpart, through projections. The tools are:
  - **`conference_overview`** returns:
    - phase and deadlines; formats and tracks
    - counts by status, type, track, language and participation mode (non-draft, own and conflicted included, since counts reveal nothing)
    - `draftCount`, a single number
    - `submittedByDay`, in the conference time zone
    - `withSelfIdWarnings`, `withPendingInvitations` and `incomplete`
    - `withoutAvailableChair`: submitted proposals that no chair or track chair can manage, because each is a contributor or conflicted
  - **`list_submissions`** takes a `SubmissionQuery` and returns projections.
  - **`get_submission`** returns one projection.
  - **`presenter_cap_report`** returns the chair report: confirmed contributions only, within the acting person's chair access, plus the pending count.
- **Tiers:** tier M gets metadata. The contributors in the metadata view carry `status`, and the view also includes `participationMode`, `issueCodes` and the self-identification warning count. Tier C gets exactly what its owner would see.

### 2.5 Fixtures and the dry run
- **`seedOpenCall(db, { slug, now })`** clones ELO 2027 with deadlines relative to the clock and the phase set to `cfp_open`. Development and the e2e tests use it, so tests pass on any date.
- **Dry run:** `import-config <file> --slug elo2027-dryrun --window <open>/<close>`. It is human-only and audited, and the runbook shows the exact command.

## 3. Acceptance

**Policy**
- Blindness properties for every new field:
  - an invitee's profile markers appear in no view until they confirm
  - unconfirmed or declined names never reach single-blind, open or public views
  - a declined invitee is conflicted
  - a never-submitted submission is invisible to non-contributors whatever its status
  - `/check` output for a lead never contains another person's cap count or another submission's ID
  - reviewer output is the same whether or not a cited surname belongs to an author
- Every action is tested for the owner, a confirmed co-author, an invitee, a declined person, a chair, a reviewer and agents.

**Server, for every route**
- the happy path
- refusals: wrong person, agent, closed call, wrong phase, stale version
- 422 issues
- rate limits
- audit rows, with `findLeaks(auditRows, markers)` empty after every mutation
- mail language
- CSV injection escaping and row selection
- leak checks on tier M responses

**MCP:** a real `Client` over Streamable HTTP lists the tools and calls each one with a tier M token, and `findLeaks` passes on each result. A tier C token on the public listener gets 403 and an audit row, and a cookie gets 401.

**e2e at 390×844, on any date**
1. Open the call.
2. Start a talk.
3. Watch the word count.
4. See a self-identification warning.
5. Invite a co-author, who confirms by the invitation link.
6. Acknowledge the agreements and submit.
7. Receive the receipt.
8. Find it in My submissions.
9. A panel of three invitees: one declines and is replaced.
10. An exhibition work submitted by URL.
11. A chair finds the submissions and downloads both CSVs.

axe reports no violations on any new page. CI is green.

## Deferred

These were set aside on purpose, with the reason for each.

**Waiting on the Barranquilla team**
- **Per-paper panel abstracts.** This depends on their CFP. If it asks for them, add `panelItems` to the submission type.

**Not needed for the January launch**
- **Transferring ownership.** Chairs can reassign it in the database, with an audit row.
- **A chair removing a pending invitee.** The invitation conflict and `withoutAvailableChair` expose the abuse case in the meantime.
- **Purging people created by unanswered invitations.** This belongs with the data-retention work.
- **Presentation and work languages.** Use custom fields if the CFP needs them.
- **Several affiliations per person.**
- **Email change.**
- **ORCID sign-in.**
- **File uploads.**
