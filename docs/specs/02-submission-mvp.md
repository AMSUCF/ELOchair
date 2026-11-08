# Spec 02: Submission MVP

**Phase:** Submission MVP (plan §9: Nov 23 – Dec 20, 2026). The portal opens in January 2027.
**Builds on:** [spec 01](01-foundations.md). It follows the house rules in [AGENTS.md](../../AGENTS.md) throughout.

The goal is to open a call for proposals that people can submit to from a phone, in English, Spanish or Portuguese. Chairs can follow along, and so can their agents, without seeing anything the policy hides.

## Decisions taken for this spec

These are the plan's accepted defaults, made concrete. Change them in review, not in code.

- **Who edits.** The **lead** (the person who created the submission) edits content, manages co-authors, submits and withdraws. Co-authors can see the submission (submitter view) and confirm or decline their invitation, but cannot edit it. This avoids edit conflicts and is easy to explain.
- **Co-authors.** The lead invites a co-author by email, with a role.
  - If the person is new, the lead may supply their name and affiliation. The lead can never overwrite an existing person's profile.
  - An invited co-author counts as a contributor straight away (strict blindness). Declining removes them.
  - A submission can be submitted while invitations are pending.
- **When editing is allowed.** Creating, editing, submitting and withdrawing need the conference in phase `cfp_open` *and* the current time inside the submission window from `deadlines`.
  - After the window, submissions are read-only.
  - A submitted submission stays editable until the deadline. Every edit is validated and audited.
- **Warnings, not blocks.** Two things warn but never stop a submission:
  - **Self-identification:** an anonymized text mentions an author's name, affiliation, email, ORCID iD, or a web address on an author's own domain. This applies only to double-blind types.
  - **Presenter cap:** someone would hold more than the cap of counted roles across submitted work.

  **Blocking errors** are the existing `validateSubmission` issues: word limits, required fields, team size, a lead.
- **Dry run.** Committee volunteers try the CFP on a separate conference (for example `elo2027-dryrun`), imported with `import-config` and opened with `set-phase`. No special mode exists.
- **Mail language.** Mail goes in the recipient's first profile language among en, es and pt, or else the language of the request.

## In scope

### M1. Schema and policy
- **`Contribution.status`:** `invited` or `confirmed`. The lead is confirmed when the submission is created.
- **Input schemas** (Zod, in `packages/schema`):
  - creating a submission (type, language)
  - updating content (title, abstract, track, topics, language, fields, and type while it is a draft)
  - inviting a co-author (email, role, optional name and affiliation for a new person)
  - changing a co-author (role, order)
  - editing your own profile
- **`selfIdentificationWarnings()`** (Zod-free, exported from `/pure` so the form can warn live). Matching is accent- and case-insensitive and respects word boundaries. It checks for:
  - author full names
  - surnames used as citations, such as "(Surname 2021)" or "Surname (2021)"
  - affiliations
  - emails
  - ORCID iDs
  - URLs on an author's non-generic email domain or containing their surname

  It scans the title, abstract and every non-identifying custom field, and returns paths and kinds only.
- **Policy decides who edits:** `canEditSubmission`, `canManageContributors`, and the invited person's confirm and decline. Agents never edit.
- **Projections:**
  - The submitter and chair views carry contributor `status`.
  - Metadata (tier M) adds `contributorStatuses` and a count of self-identification warnings. Both are numbers or enums only.
  - New blindness properties cover the new fields.

### M2. Server
- **Migration:** `contributions.status`.
- **Routes** (cookie sessions; agents are read-only):

  | Route | What it does |
  |---|---|
  | `POST /api/conferences/:slug/submissions` | Create a draft. Returns the submitter view. |
  | `GET /api/submissions/:id` | Get a projection for the viewer. |
  | `GET /api/submissions/:id/check` | `{ issues, warnings: { selfIdentification, presenterCap } }` |
  | `PATCH /api/submissions/:id` | Update content (lead, inside the window). |
  | `POST /api/submissions/:id/submit` | Submit. 422 with `issues` when invalid. Otherwise emails every contributor and returns any warnings. |
  | `POST /api/submissions/:id/withdraw` | Withdraw (lead). Emails contributors. |
  | `POST /api/submissions/:id/contributors` | Invite a co-author (lead). Emails the invitee. |
  | `PATCH /api/submissions/:id/contributors/:personId`, `DELETE …` | Change or remove a co-author (lead; the lead cannot be removed). |
  | `POST /api/submissions/:id/invitation/confirm`, `…/decline` | The invited person answers. |
  | `GET /api/me/submissions` | Every submission you contribute to, with its conference and deadline. |
  | `GET /api/me/invitations` | Your pending invitations. |
  | `PUT /api/me/profile` | Edit your own profile. |
  | `PUT /api/conferences/:slug/phase` | Admin, human only, audited. |
  | `GET /api/conferences/:slug/submissions?status=&type=&track=&language=&q=` | Filters on the existing projected list. `q` matches title text only for viewers who can see titles. |
  | `GET /api/conferences/:slug/submissions.csv` | Chairs. Human sessions, or tier C on the internal listener. Built from chair projections. |

- **CLI:** `set-phase <slug> <phase>`.
- **Mail** in en, es and pt for submission received, submission withdrawn, and co-author invitation.
- Every mutation is audited.

### M3. MCP endpoint (read-only)
- **Endpoint:** `/mcp` on both listeners. Streamable HTTP, stateless, JSON responses, bearer agent tokens only.
- **Tier rules:** tier M works on the public listener; tier C is refused there and works on the internal one (the same rule as the REST API).
- **Tools:**

  | Tool | Returns |
  |---|---|
  | `conference_overview` | Phase, deadlines, types and tracks, plus counts by status, type, track and language |
  | `list_submissions` | Filters (status, type, track, language) and paging; projections only |
  | `get_submission` | One submission, projected |
  | `presenter_cap_report` | Presenter-cap counts and who is over the cap |

  Each tool returns what the token's tier allows: metadata for M; the chair view for C, internal listener only.
- Every tool call is written to the audit log (tool name and arguments, never results).

### M4. Web
- **CFP page:** a "Submit a proposal" call to action while the window is open.
- **Choose a format:** `/:lang/c/:slug/submit` lists the formats and creates a draft.
- **Edit a submission** at `/:lang/s/:id`:
  - title and abstract with live word counts against the limits
  - track, topics, language, and custom fields by kind
  - co-authors: invite, change role, reorder, remove
  - an error summary with links to the fields
  - live self-identification and presenter-cap warnings
  - save draft, submit, and withdraw (with confirmation)
  - a warning before leaving with unsaved changes
- **My submissions** at `/:lang/my`, with status and deadline.
- **Account** (`/:lang/me`): profile editing and pending invitations with confirm and decline.
- **Chair list** at `/:lang/c/:slug/manage`: filters, counts, presenter-cap warnings and a CSV download.
- **Language:** every string in en, es and pt.

### M5. Tests and acceptance

- **Policy:** blindness properties pass for the new fields. Edit permissions are tested for the lead, a co-author, an invitee, a chair, a reviewer and agents.
- **Server:** every route is tested for the following:
  - the happy path
  - permission refusals: wrong person, agent, outside the window, wrong phase
  - validation (422 with issues)
  - audit rows
  - mail sent in the right language
  - CSV and MCP access rules
  - leak checks on tier M responses, including MCP
- **e2e at phone size:**
  1. Open the CFP.
  2. Create a talk.
  3. Watch the word count.
  4. See a self-identification warning.
  5. Invite a co-author, who confirms.
  6. Submit and receive the confirmation email.
  7. Find it under "My submissions".
  8. Have a chair find it in the chair list and download the CSV.

  axe reports no WCAG 2.1 A/AA violations on any new page.
- **CI:** green.

## Out of scope (later)
- File uploads (full papers, posters). Exhibition works are submitted by URL in this phase.
- Reviews, assignments UI, decisions, notifications (review-setup phase onward).
- Late-submission extensions per person.
- Membership checks (confirmation phase).
