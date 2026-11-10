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
- **Agents never change submissions.** Write routes answer 403 `agents_read_only` before any other check. The invitation link routes refuse agents the same way, so an agent can neither read an invitation nor answer one.
- **The decision lives in `packages/policy`** (`canActOnSubmission`). Routes ask the policy; they do not decide.

### 1.2 Invitations protect the invitee
- The invitation stores what the owner typed: `invited_email`, plus optionally `invited_name`, `invited_affiliation` and `invited_lang`.
  - Nothing the owner types is ever written to `people`.
  - Until the invitee confirms, every view renders that contributor from the invitation fields only, never from their profile. Answers are therefore identical whether or not the address already has an account.
  - This includes the chair view and both CSVs. An invited or declined contributor appears as the owner typed them (name, affiliation, email), with no country, pronouns, ORCID or bios. Someone who confirmed and later left reverts to the typed values.
- **Inviting creates a conflict** (`kind: coauthor, declared_by: system`) between the invitee and the submission. It survives declining or leaving, so someone who has seen the full submission can never be assigned to review it.
- **Declining or leaving** sets status `declined`; the row is kept as evidence.
  - Declined contributors disappear from every view except the chair view, and from team counts and the presenter cap. A chair's tier M view of their own submission hides them too: it is the contributor's view, not the chair's.
  - Declining is always allowed, even after the deadline and on withdrawn work, because a person must always be able to refuse authorship.
  - The owner is emailed whenever someone confirms, declines or leaves. The notice names the person as the owner typed them (name, or else the address) and links to the proposal.
- **Single-blind, open and public views list only confirmed contributors.** An unconfirmed name is never shown to reviewers.
- **Limits:**
  - 20 invitations per owner per day, and 5 per recipient address per day across all owners.
    - They are counted in a server-internal ledger (`invitation_sends`, IDs only, never projected), so removing an invitee or deleting a draft does not give budget back. Resends count toward both limits.
    - Concurrent invitations take advisory locks for the owner and the address before counting.
  - Pending plus confirmed contributors may not exceed the type's `team.max`.
  - Someone who declined cannot be re-invited to the same submission.
  - Resending is limited to once an hour per invitation.
- **The invitation email** is fixed text in the invitee's language:
  - It contains the owner's display name (one line, with links, bare domains, email addresses and invisible formatting characters removed), the conference title, the format, the role, and a link.
  - It contains no submission title, no abstract, and no name the owner typed for the invitee. ELO's signed mail must not carry text an attacker wrote to people who have not agreed to anything.
  - If the proposal is withdrawn while the invitation is pending, the invitee gets a notice without the title, in the invitation's language.
  - Mail to people who are part of the proposal (receipts, withdrawal notices, answers to the owner) shows owner-written text, such as the title, as typed: one line, without invisible formatting characters, cut with an ellipsis past 300 characters. Titles such as "Poems with p5.js" stay whole.
  - Once sent, the outbox keeps a copy with the link token removed (sign-in mail likewise loses its link and code), so the database and its backups hold no working link.
- **The invitation link** carries a single-use token, stored only as a hash. It expires at `submissionsClose` or after 14 days, whichever is later; declining stays possible after the close.
  - It opens `/:lang/invitation#token`. That page shows the conference, the format, the title, the owner, the role, and what the role means for the presenter cap. On withdrawn work it offers only Decline.
  - **Decline** needs no account.
  - **Confirm** needs the agreements to be acknowledged (§1.5). It does not sign the person in; it offers sign-in afterwards to complete a profile.
  - **Confirm needs a name** when the person's profile has none, typed by the invitee: otherwise 422 `[{path: "displayName", code: "required"}]`. The field is never prefilled with the name the owner typed, which may appear only as context. A submitted proposal therefore stays valid when an invitee confirms.

### 1.3 Lifecycle and deadlines
- `draft → submitted ⇄ draft` (return to draft, before the close) `→ withdrawn` (final).
- Drafts are created only by an explicit **Start**, after a format and abstract language are chosen.
- Drafts can be deleted outright: a hard delete by the owner. The audit row keeps IDs only, and pending invitees are told.
- **The call is open** when the phase is `cfp_open` and the server's receipt time `t` satisfies `submissionsOpen ≤ t < submissionsClose` (`isCallOpen`). There is no grace period, and the client clock never decides anything: the conference, Start and editor pages follow the `callOpen` the server returns.
  - Create, edit, invite, remove, return to draft, submit and delete need an open call.
  - **Withdraw** (from `submitted` only) is allowed in phases `cfp_open`, `reviewing` and `deciding`, whether or not the call is open. Withdrawal mail goes to every confirmed contributor and to `contactEmail`, with the title and the proposal's link; pending invitees get the notice without the title (§1.2).
  - **Confirm** needs an open call and work that is not withdrawn. **Decline and leave** are always allowed, whatever the status or phase.
- **Submitted work stays valid.** A submitted submission always passes `validateSubmission`.
  - An edit or co-author change that would break this returns 422 `issues` and saves nothing.
  - To make bigger changes (swap a full panel, change format), return to draft, edit, and submit again before the close.
  - A decline after the close can still invalidate a submission. Its metadata then carries `issueCodes`, and chairs see it as **incomplete**.
- **Concurrency.**
  - Every submission has an integer `version`. Writes must send the version they edited; a stale one gets 409 `stale`.
  - Each mutation runs in one transaction that locks the submission row and uses one `now` for the whole request.
  - Submit is `UPDATE … WHERE status = 'draft'`: mail goes out only if a row changed, so a double tap on a phone sends one receipt.
- **Phases** move forward only, except `draft ⇄ cfp_open`. Any other move needs `--force` and a non-blank reason. Every move is audited (the API or CLI user, from, to, reason).
  - Every move goes through `movePhase()`, which locks the conference row, so two concurrent moves cannot skip the rule. That covers `PUT /phase`, `set-phase`, `import-config --phase` on an existing conference (a refused import changes neither the configuration nor the phase) and `seed --force`.
  - `seed --force` rebuilds the built-in placeholders and is refused in production.
- **Visibility.** The policy treats a submission that was never submitted (`submittedAt` null) like a draft, whatever its status. Contributors only.

### 1.4 What each person learns
- **Presenter cap.** People are told about their own counts only.
  - `/check` and the submit response report only the requesting person's count, as `{ count, max }`.
  - The invitation page tells the invitee what confirming would do to their own count.
  - Only chairs see everyone's counts. The cap report counts **confirmed** contributions only, and lists pending invitations separately as a number.
  - The wording comes from the configuration: "This conference programs at most {max} first-author or presenting roles per person ({types} do not count). You have {n} in submitted proposals."
- **Self-identification checks** run live in the browser on the owner's own data, as names, affiliations and emails the owner can already see. The server check (`/check`, submit) is authoritative and adds ORCID iDs and email domains.
  - Citations are recognized in narrative form (`Pérez et al. (2021)`, `Pérez y Gómez (2020)`, `Pérez, Gómez y Ruiz et al. (2020)`, `Pérez's (2019)`, `Pérez [2019]`), in parentheses, and as reference-list entries (`Pérez, A. L. (2021).`, `GONÇALVES, João Carlos. … 2020.`), as are names joined in link hosts and paths.
  - A list joined by commas alone is a place, not co-authors (`León, Guanajuato (2019)`). An article (la, las, lo, los, les) before a surname makes it a place or a title, unless the person's own name has it. "El" and "Le" are not treated as articles, because they are often part of a cited surname.
  - Whitespace runs are collapsed and every repetition is bounded, so the detector runs in linear time on any input. Tests hold it to a time budget on hostile text.
  - The editor shows the server's findings only for text unchanged since that check; the live hints cover edited text.
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
  - A missing requested bio, and a bio longer than `rules.bio.maxWords` in any language (`longBios`), are warnings, not blocks.
- **Input hygiene.** Title, abstract, custom-field text and bios accept tabs and line breaks but no other control characters, and no ill-formed Unicode (400 `invalid`). One-line fields (display name, affiliation, pronouns, invited name and affiliation) also refuse invisible characters (format characters and default-ignorable code points: bidi controls, zero-width spaces, soft hyphens, variation selectors, tag characters, combining grapheme joiners, Hangul fillers) and need at least one letter or digit. Any of these could carry hidden text, one character per byte. The exceptions are defined once in `packages/schema/src/invisible.ts`, which mail cleanup and the browser use too:
  - a zero-width joiner between letters, marks or digits of a script spelled with joiners (Arabic, Syriac, Thaana, N'Ko, Mongolian, the Indic scripts, Sinhala, Myanmar, Khmer) or between emoji. Nowhere else (Latin, Greek, Cyrillic, Han, kana, Hangul, Hebrew, Thai, Georgian…) does a spelling need one;
  - a joiner after an Indic virama (legacy Malayalam chillus, Bengali khanda ta);
  - one presentation selector after an emoji, and after a digit, `#` or `*` only in a keycap;
  - the three standard subdivision flags (England, Scotland, Wales).
  - Halves of surrogate pairs are stray too. What remains can carry at most a bit or two per character of text in those joining scripts or emoji, which cannot spell instructions. Japanese ideographic variation selectors and Mongolian variation selectors are not kept, a deliberate trade-off. Machine keys are at most 64 characters.
- The chair view and CSV include pronouns.

### 1.7 What ELO's formats need now
- **`participationMode`** (`in_person`, `online` or `undecided`) is a core submission field. It is required when the conference is hybrid, and it is visible to tier M as an enumeration.
- **`language`** is the language of the abstract, one of the conference's languages.
- **Panels** get one session abstract. Per-paper panel abstracts (2022, 2025) depend on the Barranquilla CFP; see Deferred.

### 1.8 ELO 2027's formats
The call was published in November 2026 at <https://elo27.eliterature.org/>. `packages/schema/src/conferences/elo2027.ts` follows it, and `packages/schema/src/elo2027.test.ts` is the record of what it says.

| Format | Abstract | Slot | Review | Also asks for |
|---|---|---|---|---|
| Paper (`talk`) | up to 300 words | 15 min | anonymized | |
| Lightning talk (`lightning`) | up to 150 words | 5 min | anonymized | |
| Panel (`panel`) | rationale, up to 150 words | | anonymized | the abstract of each paper or talk (required); three to six people |
| Artist talk (`artist_talk`) | up to 300 words | 15 min | anonymized | |
| Workshop (`workshop`) | description and goals, up to 300 words | 60 min | anonymized | participants expected, 15 to 30 (required); tools and room conditions (required) |
| Reading or performance (`performance`) | up to 300 words | | names visible | technical requirements; a link to the work |
| Work for the exhibition (`exhibition`) | up to 300 words | | names visible | a link to the work |

- **Curatorial pitches** go by email. They are in the configuration as `otherFormats`, which the conference page lists and nothing else uses.
- **Submissions are in English or Spanish** (`languages`). The interface is also in Portuguese.
- **No minimum length.** The call gives only maxima, so `minWords` is 1: an abstract must be there. The interface then says "up to 300 words", never "1 to 300".
- **A number field may have a range** (`min`, `max` on the field). Outside it, submitting is refused with `out_of_range`.
- **Where the call is silent, earlier defaults stand** until the organisers say otherwise: three anonymized reviews for the call's "academic" formats and two with names visible for its "artistic" ones; team sizes; panels not counting toward the cap of two; one bio limit of 300 words for the whole conference (the call asks for 250, and 200–300 for the exhibition: [issue #17](https://github.com/AMSUCF/ELOchair/issues/17)).
- **Panels** hold their papers' abstracts in one required field until submissions can carry them as separate items ([issue #15](https://github.com/AMSUCF/ELOchair/issues/15)).

## 2. Contracts

### 2.1 One query, one shape
- **`SubmissionQuery`** (Zod, `packages/schema`) is used by the REST list, both CSVs and the MCP tools:
  - filters: `status[]`, `type`, `track`, `language`, `participationMode`
  - booleans: `hasSelfIdWarnings`, `hasPendingInvitations`, `incomplete`
  - `q`, a title search
  - paging: `cursor` and `limit`. Paging is by key: the cursor holds the position just after the last item of the previous page (`createdAt`, `id`), sealed with AES-GCM under a key derived from `SECRET_KEY`.
    - Compared, never looked up, a cursor continues correctly whatever happened to that item since (withdrawn, returned to draft, deleted).
    - Sealed, it shows no creation time the viewer's projection leaves out, and cannot be forged to probe for submissions.
    - It is bound to its list (the conference and the person looking; an agent pages as its owner), so it does not open on another conference's list or for another person, and cannot be used to bracket a creation time there. Only the exact text the server produced opens.
    - A cursor the server did not seal gets 400 `invalid` at path `cursor` (REST) or `{invalid: ["cursor"]}` (MCP); an empty one means the first page. Changing `SECRET_KEY` invalidates open cursors, and clients start over.
- **`querySubmissions(viewer, conference, query)`**, on the server:
  - projects every record first, then filters only on projected fields, ordered by `(createdAt, id)`
  - returns `{ items, total, excludedCount, nextCursor }`
  - `excludedCount` counts the submitted proposals the acting person cannot manage as chair: their own and conflicted work, and work outside a track chair's tracks. It is the same for a chair and the chair's agents, whatever the filters.
  - when the viewer cannot see titles, `q` gets 400 `q_not_allowed`
- **Errors:**

  | Situation | Status | Body |
  |---|---|---|
  | Invisible or missing | 404 | `not_found` |
  | Malformed input | 400 | `invalid` with `{path, message}` |
  | Breaks a submission rule | 422 | `{ error: "invalid", issues: SubmissionIssue[] }` |
  | Call closed or wrong phase | 409 | `call_closed` |
  | Stale version | 409 | `stale` |
  | Agent on a write route or an invitation link route | 403 | `agents_read_only` |
  | Over a limit | 429 | `rate_limited`, audited |

  - The answer routes return 404 when the caller has no contribution on the submission, and 409 `already_answered` only for the caller's own answered row.
  - Rate-limit audit rows name the limit, never the address or the IP: `contributor.invite_rate_limited`, `contributor.resend_rate_limited`, `person.rate_limited`, `invitation.rate_limited` and `auth.rate_limited`. They are written after the rollback, so a refused request still leaves its row.
  - Invitation and resend refusals are audited every time, because they are bounded by the write limit. The per-person write limit, the invitation-link limit and the sign-in limits audit the first refusal in each window, so a flood of refused requests does not become a flood of audit rows.

### 2.2 Routes

| Route | Who | Notes |
|---|---|---|
| `POST /api/conferences/:slug/submissions` | signed-in person | `{typeKey, language, ownRole}`; owner is confirmed |
| `GET /api/submissions/:id` | per policy | projection |
| `GET /api/submissions/:id/check` | submitter or chair (human) | `projectCheck()` |
| `PATCH /api/submissions/:id` | owner, open call | `{version, …content}`; type change only while a draft (answers the new type does not define are dropped); custom-field keys the type does not define get 422 `unknown_field`; 422 if it would invalidate submitted work |
| `DELETE /api/submissions/:id` | owner, draft, open call | hard delete; invitees told |
| `POST /api/submissions/:id/submit` | owner, open call | `{version, acceptedAgreements}`; mail to contributors |
| `POST /api/submissions/:id/unsubmit` | owner, open call | back to draft |
| `POST /api/submissions/:id/withdraw` | owner | submitted only; phases cfp_open, reviewing, deciding |
| `POST /api/submissions/:id/contributors` | owner, open call | invite `{version, email, role, name?, affiliation?, lang}` |
| `PATCH /api/submissions/:id/contributors/:personId` | owner, open call | `{version, role?, position?}`; `position` is an index into the live (not declined) list |
| `DELETE /api/submissions/:id/contributors/:personId` | owner, open call | not the owner |
| `POST /api/submissions/:id/contributors/:personId/resend` | owner, open call | once an hour |
| `POST /api/submissions/:id/leave` | confirmed contributor (not owner) | always, withdrawn work included |
| `POST /api/invitations/info` | holder of an invitation token (not agents) | details for the invitation page, with `nameNeeded` and the submission's `status` |
| `POST /api/invitations/answer` | holder of an invitation token (not agents) | `{token, answer, acceptedAgreements?, displayName?}` |
| `GET /api/me/submissions` | person | with conference, deadline, own cap count |
| `GET /api/me/invitations` | person | pending invitations (also answerable while signed in) |
| `POST /api/me/invitations/:submissionId/answer` | person | same as above, by session |
| `PUT /api/me/profile` | person | strict |
| `GET /api/conferences/:slug` | anyone who can see the conference | configuration, phase and `callOpen` (server clock) |
| `PUT /api/conferences/:slug/phase` | admin (human) | forward only unless `force` + `reason`; row-locked |
| `GET /api/conferences/:slug/submissions` | per policy | `SubmissionQuery` |
| `GET /api/conferences/:slug/submissions.csv` and `contributors.csv` | chair (human), or tier C on internal | §2.3 |

Write routes have a 64 KB body limit and 60 writes a minute per person. Input schemas cap characters: title 300, abstract 8 × maxWords, each field 10,000.

### 2.3 CSV exports
- **Rows:** only submissions where `submissionAccess(person, r) === "chair"` (so a chair's own and conflicted submissions are left out). The response says how many were omitted (`X-Omitted-Rows`, the list's `excludedCount`). List filters apply. Every matching row is included: the server pages internally and ignores any `cursor` or `limit`.
- **`submissions.csv`**, one row per submission:
  - reference, id, status, type (key and label), track, topics, language, participationMode
  - title, abstract, abstract words
  - created, submitted and updated times (ISO 8601 in the conference time zone)
  - contributors (`Name <email> (role, status)` joined with `; `)
  - pending invitations, issue codes, self-identification warning count, over-cap flag (only when a confirmed contributor in a counted role, on a type that counts, is over the cap)
  - one `<type>.<field>` column per custom field
- **`contributors.csv`**, one row per contribution: reference, position, role, status, name, email, affiliation, country, pronouns, has-bio. Invited and declined rows come from the invitation fields only (§1.2).
- **Format:**
  - UTF-8 with a BOM, every cell quoted (RFC 4180)
  - any cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`
  - `Content-Disposition: attachment` and `Cache-Control: no-store`
  - each export is audited (`submissions.exported`, with kind, row count and filters)

### 2.4 MCP (read-only)
- **Endpoint:** `/api/mcp`, so it inherits the token resolution, tier C refusal on the public listener and agent audit of `/api/*`. Cookie sessions get 401. Transport is Streamable HTTP, stateless, with JSON responses.
- Only read tools are registered. Each tool call writes one `agent.mcp_tool` audit row containing the tool name and its validated enum and ID arguments. Arguments are validated before the audit: invalid ones are refused with `{error: "invalid", args: [names]}` and audited as `{invalid: [names]}`, so free text never reaches the audit log.
  - The advertised input schema uses plain bounded strings, so the handler sees, validates and audits every call within those bounds. The SDK itself refuses calls that break the advertised schema (a wrong JSON type, an over-long string, a value outside an enum). Those leave only the middleware's `agent.request` row, and no value is stored.
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
- **`seedOpenCall(db, { slug, now })`** clones ELO 2027 with deadlines relative to the clock and the phase set to `cfp_open`. Development and the e2e tests use it, so they exercise what people will really be offered, on any date.
- **`seedTestCall(db, { slug, now })`** does the same with a made-up call (`apps/server/src/fixture-call.ts`) whose formats and limits never change. Server tests use it, so a decision by a conference's organisers never breaks a test that is about something else.
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
10. An exhibition work submitted by URL, on a phone whose clock is wrong.
11. Invitees answer in the app: each gives their own name; one confirms then leaves, one declines.
12. A new invitee must give their own name to confirm by link, and the owner then sees that name.
13. Withdrawn work: a pending invitee can only decline by link, and a confirmed co-author can leave.
14. Reordering around a declined panelist changes the visible order, which a reload keeps.
15. A co-author's bio longer than the call's limit gets a note in the owner's editor.
16. A chair finds the submissions, opens one (with a declined contributor), sees localized problem labels, and downloads both CSVs through their links.

axe reports no violations on any new page, in light and dark mode. CI is green.

## 4. Review before the dry run

On November 8–9, 2026, the built MVP had an adversarial review, followed by six more review rounds on the fixes.

| Round | Reviewed | Confirmed | Rejected | Notes |
|---|---|---|---|---|
| 1 | The MVP: lifecycle and concurrency, authorization and privacy, consent, audit and mail, web UI, schema and policy | 64 | 6 | 3 high: invitation limits bypassed by remove and re-invite; stale saves losing typed text; submit after unsaved edits always stale |
| 2 | The round 1 fixes, area by area | 19 (17 distinct) | — | 1 high: quadratic backtracking in the new citation patterns |
| 3 | The round 2 fixes | 6 | — | All low: tag characters as a hidden-text channel; lost citation forms; a cursor that revealed whether an unseen draft existed; a late retry moving focus |
| 4 | The round 3 fixes | 5 | — | 1 medium: other invisible characters (variation selectors, unassigned tags, grapheme joiners) still carried hidden text; low: paging broke when the boundary item was returned to draft (now a position cursor), invitation mail used its own invisible-character rule, two documentation claims |
| 5 | The round 4 fixes | 7 | — | 2 medium: a kept joiner could split a domain in invitation mail; the position cursor showed creation times to reviewers and the public (now sealed). Low: surrogate halves, legacy Malayalam names, joiners in Latin text, the name cut, test fixtures and comments |
| 6 | The round 5 fixes | 6 | — | 1 medium: removing an IP address could join its neighbours into a domain (removals now leave a space). Low: cursors replayable across conferences (now bound to their list) or with an extra character; the web dropping a legacy Malayalam joiner; a title cut leaving a joiner; joiners kept in scripts that never use them (now an allow-list); tests that would have passed without the fix |
| 7 | The round 6 fixes, for regressions and medium-or-higher issues only | 2 | — | 1 medium regression: the script list also matched punctuation and spaces those scripts share, so a joiner after an ideographic full stop could hide an internationalized domain (joiners now need letters, marks or digits on both sides). 1 low: a joiner next to a narrow no-break space. Cursor binding: none |

How each round worked:
- Each finding had a concrete scenario, most reproduced against the running app.
- An independent verifier tried to refute every finding before it counted.
- Every fix has a regression test, and the significant ones were mutation-checked: the fix was reverted to see the test fail, then restored.
- Fixes were made in isolated worktrees split by file ownership, then merged and run through `npm run check` and the e2e suite.

The rules and contracts above describe the reviewed behaviour. Machine-drafted Spanish and Portuguese strings added during the review still need native review.

## Deferred

These were set aside on purpose, with the reason for each.

**From the Barranquilla call, not yet built**
- **Per-paper panel abstracts as separate items.** The call asks for 150-word abstracts of three to four papers or five to six lightning talks, plus a 150-word rationale. For now they share one field (§1.8); adding `panelItems` is tracked in [issue #15](https://github.com/AMSUCF/ELOchair/issues/15).
- **Bio lengths by format** ([issue #17](https://github.com/AMSUCF/ELOchair/issues/17)), and deadlines shown as "anywhere on Earth" ([issue #16](https://github.com/AMSUCF/ELOchair/issues/16)).

**Not needed for the January launch**
- **Transferring ownership.** Chairs can reassign it in the database, with an audit row.
- **A chair removing a pending invitee.** The invitation conflict and `withoutAvailableChair` expose the abuse case in the meantime.
- **Purging people created by unanswered invitations.** This belongs with the data-retention work.
- **Presentation and work languages.** Use custom fields if the CFP needs them.
- **Several affiliations per person.**
- **Email change.**
- **ORCID sign-in.**
- **File uploads.**
