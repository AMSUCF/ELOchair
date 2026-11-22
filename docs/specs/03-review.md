# Spec 03: Review

**Phase:** Review. It must be ready before the ELO 2027 call closes (2027-02-14).
**Builds on:** [spec 01](01-foundations.md) and [spec 02](02-submission-mvp.md). It follows the house rules in [AGENTS.md](../../AGENTS.md) throughout.
**Tracking:** [issue #33](https://github.com/AMSUCF/ELOchair/issues/33).

The goal is that the chairs of a conference run its review from the app, without a developer, and that reviewers do their part from a phone without ever learning what the policy hides.

## Three rules

Everything below is held to these. They decide what is left out.

1. **As simple as possible.** One list and one form for reviewers. One page per job for chairs. A feature that needs explaining waits.
2. **Clear guidelines.** Every screen says in plain words what the person is looking at and what happens when they press something. Reviewers see the chairs' guidelines where they work.
3. **Chairs can edit it.** Reviewer guidelines, criteria, email texts and review settings are changed by the chairs in the app, with every change reviewed before it is saved. No developer, no file on the server.

## 1. Rules

### 1.1 Who does what
- **Chairs** do everything in this spec. In the app a chair may do whatever an admin may, moving the phase included: `chair`, `admin` and site admins are one group (`isConferenceChair`). The `admin` role stays in the data and means nothing more.
  - Adding or removing formats, fields and languages still has no screen. It is done by importing a configuration (spec 02, §1.9).
- **Reviewers** belong to one or more review pools. ELO 2027 has two: the scientific committee and the artistic committee. A reviewer sees only the proposals assigned to them.
- **Track chairs** are not part of this version: ELO 2027 has no tracks. The role stays in the data; no screen offers it.
- **Agents** never assign, review or decide. They read what spec 01 already allows.
- **Whether more roles are needed** is being asked of the conference chair. Nothing here depends on the answer.

### 1.2 People
- A **People** page (`/:lang/c/:slug/people`, linked from "Manage submissions") is for the conference's chairs, in person. It lists:
  - the chairs: everyone with the `chair` or the `admin` role, shown simply as chairs;
  - the reviewers, under each review pool they belong to, each with the number of proposals assigned to them and what they said when they accepted (the languages they review in, the most proposals they will take). There are no reviews yet, so none are counted.
    - That number counts the proposals the chair who is looking manages as a chair. Their own proposals and those they have a conflict with are left out: a chair may not learn who reviews their own work (§1.3), and a count would give it away.
  - track chairs, where a conference has any: they can be removed and never added (§1.1);
  - the invitations that are waiting, were declined or have expired, with when they were sent.
  - A site admin holds no role at the conference and is not listed.
- **Who is shown how.** A person who holds a role is shown by their profile: name and address. An invitation that has not been accepted is shown only as the chair typed it (the address, and a name if the chair typed one), never from the invited person's profile. The page is therefore the same whether or not the address has an account (spec 02, §1.2).
- A chair **invites** one address at a time: the address, an optional name, the role (reviewer or chair), for a reviewer one or more of the conference's review pools, and the language of the email (`en`, `es` or `pt`).
  - The name is for the chairs' own list. It is never mailed and never written to anyone's profile.
  - **Refused**, in plain words: a second invitation to the same address and role while one is waiting (409 `already_invited`), and an invitation to someone who already holds that role at this conference (409 `already_has_role`; a chair or an admin holds "chair"). The People page shows both facts anyway, and nothing else about the address is said.
  - **Limits.** 200 invitation emails a day per inviting chair, and 3 a day per recipient address, each across all conferences; the same invitation is sent again at most once an hour. Resends count toward both daily limits.
    - They are counted in a ledger of their own (`role_invitation_sends`, IDs only, never projected), which cancelling an invitation does not empty.
    - Concurrent invitations take advisory locks for the chair and for the address before counting, as proposal invitations do. The lock on the address also puts two invitations to it in order, so the second sees the first.
    - Over a limit: 429 `rate_limited`, audited every time (`role_invitation.rate_limited`, with the limit and IDs).
    - The hour is counted per invitation. Cancelling one and inviting the address again is a new invitation, which a chair may need at once (the wrong pool, the wrong language): the 3 a day per address are what bound it.
  - A chair can **send again** an invitation that is waiting, or one that expired unanswered: a new email with a new link, good for 30 days from then. The link in the earlier email stops working. It is refused when the address has since been given the role or invited again, and when none of a reviewer's pools is left in the configuration (409 `pools_gone`): that one is cancelled, and the person invited again.
  - A chair can **cancel** a waiting invitation: its link stops working, and it leaves the list. The same takes a declined or an expired one off the list. The invitee is not told.
- **The email** is one of two messages, `reviewer_invitation` and `chair_invitation`. Chairs change their wording on the settings screen like every other email (§1.8; spec 02, §1.9).
  - It goes to someone who has agreed to nothing. A text can name the conference, for a reviewer the review pools (as the configuration names them, in the email's language), and the link. The link is required and stands alone.
  - It carries no person: not the inviting chair's name, and not the name the chair typed. An invitation to a role has no such value to put into a text, and a text that names one is refused.
  - Once sent, the outbox keeps a copy with the link's token removed.
- **The link** opens `/:lang/role-invitation#token`. The token travels in the fragment, is stored only as a hash, works once, and expires 30 days after the invitation was last sent.
  - The page needs no account. It says which conference, which role, for a reviewer which committees, which address was invited, and in a sentence or two what accepting means. It has two actions, Accept and Decline. It never shows the name the chair typed.
  - **Accept** gives the role to the person the invitation was addressed to, whoever opens the link: a forwarded link cannot give the role to someone else, and nothing in the request can name another person, role or pool. Accepting signs nobody in; the page then offers sign-in with that address.
  - **A reviewer who accepts** says, on the same page, which languages they can review in (`en`, `es`, `pt`; at least one) and the most proposals they are willing to take (a whole number from 1 to 30; 8 unless they say otherwise).
    - These go to `reviewer_profiles` with the invitation's pools, and the role's scope is those pools.
    - Someone who is a reviewer already keeps the pools they have and gains these.
    - A pool the conference no longer has is not given, and the reviewer's role is never given without a pool: on a role, no scope means every pool. An invitation with none of its pools left shows no page and takes no answer.
  - **Accept needs a name** when the person's profile has none, typed by the invitee and never prefilled: otherwise 422 `[{path: "displayName", code: "required"}]`. A reviewer who names no language gets `{path: "languages", code: "required"}`.
  - **Decline** needs nothing. The People page then shows the invitation as declined.
  - **Nobody is emailed about an answer** in this version. The People page is where chairs see it.
  - A link that has expired, was cancelled, was already used or never existed gets one answer (400 `invalid_or_expired`) and one plain page, which says so.
  - Agents are refused on the link routes (403 `agents_read_only`), as for proposal invitations. The two kinds of link share one per-IP limit.
- A chair **removes** a role, after a confirmation in its place that says what will happen.
  - Removing a reviewer also deletes, in the same transaction, that person's assignments at the conference and their `reviewer_profiles` row. Nothing else of theirs is touched. (There are no reviews yet; step 6 decides what becomes of a sent review.)
    - The confirmation says how many proposals lose the reviewer, counted as the page counts them. The request names that number and removes nothing if it is no longer true (409 `stale`).
  - Removing a chair removes both the `chair` and the `admin` role. The invitations that chair sent stay the conference's: the chairs who remain see them in the list and can cancel them, and the confirmation says so.
  - **A chair cannot remove their own chair role**, on the page or through the API (409 `own_role`), so a conference always has a chair. Two chairs removing each other at the same moment cannot both succeed: the second finds that it is no longer a chair.
    - Whose role it is, is read from the role's own rows, never from the id as it was typed in the address: an id in capitals names the same person to the database, and to this rule.
  - **Every change reads the chair again inside its transaction**, under a lock on the conference's roles: someone removed while their request was on its way invites, sends again, cancels and removes nothing (403).
  - A reviewer's pools are not edited after they accept: remove them and invite them again.
- The server's `grant` command still gives any role, as before.
- **Audit.** One row per invitation sent, sent again, cancelled, accepted and declined (`role_invitation.sent`, `.resent`, `.cancelled`, `.accepted`, `.declined`), and per role removed (`role.removed`). Each holds IDs, the role, the pools and counts, and nothing else.

### 1.3 Assignments
- A chair assigns reviewers **by hand**, on the proposal's page. The list offers the reviewers of that format's pool, with each one's load beside the most they said they would take.
- **Never offered:** the proposal's own people, anyone with a conflict (spec 01), and anyone who said they cannot review it.
- An **Assignments** page shows, by pool, each submitted proposal with the reviews it has against the number the pool asks for, so that gaps are plain.
- Only submitted proposals can be assigned. A chair can assign from the day the call closes. Reviewers can open their assignments once the phase is `reviewing`.
- A reviewer can say **"I cannot review this"**, as a conflict or as outside their field. The assignment is released, a conflict is recorded when that was the reason, and the chairs are told.
- A chair cannot assign or see the reviewers of their own proposal, or of one they have a conflict with (spec 01's conflict rule, unchanged).
- There is no automatic assignment in this version.

### 1.4 Reviews
- A reviewer has **"My reviews"**: every proposal assigned to them, with its format, whether the review is not started, a draft or sent, and the day reviews are due.
- **One form**, under the proposal's text:
  - a score for each of the pool's criteria, on the pool's scale
  - comments for the authors
  - a note for the chairs only (optional)
  - an overall recommendation: accept, unsure or reject
- A review is saved as a draft, then sent. It can be changed until reviews are due, while the phase is `reviewing`. After that it is read-only.
- Unsaved text is kept in the browser as it is for proposals (spec 02).
- The chairs' guidelines for the pool are at the top of the list and of the form.

### 1.5 Anonymity
- **What a reviewer sees of a proposal** is the existing reviewer projection: the format's blind mode decides whether authors are named. For ELO 2027 the scientific committee reviews anonymized and the artistic committee sees names.
- **Reviewers are never named** to authors, in any mode, in the app or in email.
- **Reviewers do not see each other.** A reviewer sees their own review of a proposal and nothing about who else reviews it or what they wrote.
- **Chairs see reviews and who wrote them**, except for their own proposals and conflicts, where they see neither.
- **Authors receive** the comments written for them, without names and without scores, when decisions are sent (§1.6).
- Every new view is an allow-list projection in `packages/policy`, with `findLeaks()` tests. Audit rows hold IDs and enum values only, never review text.

### 1.6 Decisions
- A chair **records** accept, waitlist or reject on the proposal's page, with the reviews beside it. Recording tells nobody and can be changed.
- **Sending decisions is its own step.** The chair sees the message for each outcome, how many proposals and people get each, and confirms. Nothing is sent without that confirmation (house rule 5). Sent decisions are final in the app.
- **The phase** is moved by a chair from "Manage submissions", one step at a time. The control says what the phase does, in a sentence, and asks for confirmation. Going back needs a reason, as now. A step is refused if the conference has left the phase the page showed.

### 1.7 Email
- **The whole list of messages:**
  - to a person: the invitation to be a reviewer or a chair
  - to a reviewer: new assignments; a reminder before reviews are due
  - to chairs: a reviewer cannot review a proposal; a proposal has all its reviews
  - to authors: the decision, with the comments for them
- **Each person chooses** how much they get, on "Your account", per conference:
  - new assignments: each one, a daily summary (the default), or none
  - reminders: on (the default) or off
  - chairs' notices: each one, a daily summary (the default), or none
- Invitations, decisions and the sign-in email cannot be turned off: without them the person cannot act.
- Every message says why it was sent and links to those choices.
- All mail goes through the outbox, as now.

### 1.8 What chairs can edit
A second part of the settings screen, with the same flow as the first (spec 02, §1.9): change, review every change, save, recorded.

- **Review**, for each pool: its name, whether authors are named to reviewers, reviews per proposal, each criterion's label and scale, the reviewer guidelines (a text per language), and the day reviews are due.
- **Emails**: for every message in §1.7 and in spec 02, the subject and the body per language, with a fixed set of named placeholders such as `{title}` and `{deadline}`, a preview with sample data, and "back to the default text". The sign-in email is fixed.
- **Agreements**: title, text, link and version.
- **Guardrails**, each refused in the review step with the reason beside the value:
  - naming authors to a pool that reviewed anonymized, once that pool has an assignment
  - removing a criterion that has scores, or narrowing a scale below a score already given (relabelling is always allowed)
  - a placeholder the message does not have, or a text missing in the conference's main language
- Changes stay human-only and audited, like every configuration change.

## 2. Contracts

Shapes start in `packages/schema` (house rule 1). Additions, all optional so that stored configurations stay valid:

- `reviewPools[].guidelines`: text per language.
- `deadlines.reviewsDue`: a date and time, after `submissionsClose` and before `notification`.
- `messages`: by message key, a subject and a body per language. An absent key means the default text, which lives with the code in three languages.
- Tables: `reviews` (one per assignment: scores, both texts, recommendation, draft or sent, times), `notification_choices` (person, conference, the three choices above). `assignments` gains who made it and when it was released.
- Projections: a review as its reviewer, as a chair and as an author sees it.

Built in step 4 (§1.2):

- Messages: `reviewer_invitation` (placeholders `{committees}`, `{conference}`, `{link}`) and `chair_invitation` (`{conference}`, `{link}`). In both, `{link}` is required and stays out of the subject.
- Tables, both new (migration `0007_people_invitations`, which changes no existing table):
  - `role_invitations`: what the chair typed (address, name), the role, the pools, the language, the hash of the link's token, the person row of the address, who invited, when it was last sent and when it expires, when it was answered and how, when it was cancelled. Rows are kept: an answer or a cancellation is recorded, never deleted.
  - `role_invitation_sends`: one row per email sent (who sent, to whom, when, first or again), for the daily limits. IDs only.
- Projections, in `packages/policy`: `projectPeople()` (the People page, for a chair in person) and `projectRoleInvitation()` (the invitation page, for whoever holds the link, never an agent).
- Constants: `ROLE_INVITATIONS` in `packages/schema` holds the 30 days, the limits and the range of a reviewer's load, so that the pages say the numbers the server enforces.

Routes are written into this section as each part is built, in the form of spec 02, §2.2.

| Route | Who | Notes |
|---|---|---|
| `GET /api/conferences/:slug/people` | chair or admin (human) | `projectPeople()`: chairs, reviewers with their pools and assigned proposals, track chairs, invitations nobody accepted |
| `POST /api/conferences/:slug/people/invitations` | chair or admin (human) | `{email, name?, role, pools?, lang}`; 201 `{id}`; 409 `already_invited` or `already_has_role`; 422 `unknown_pool`; 429 over a limit |
| `POST /api/conferences/:slug/people/invitations/:id/resend` | chair or admin (human) | a waiting or expired invitation; once an hour; a new link replaces the old; 409 `not_waiting`, `pools_gone`, `already_invited` or `already_has_role`; 429 over a limit |
| `POST /api/conferences/:slug/people/invitations/:id/cancel` | chair or admin (human) | any invitation nobody accepted; 409 `already_answered` for an accepted one |
| `DELETE /api/conferences/:slug/people/:personId/roles/:role` | chair or admin (human) | `role` is `chair`, `reviewer` or `track_chair`; a reviewer's removal sends `{assignments}`; 409 `own_role` or `stale`; 404 when the role is not held |
| `POST /api/role-invitations/info` | holder of a role invitation token (not agents) | `projectRoleInvitation()`: conference, role, pools, the address, `nameNeeded` |
| `POST /api/role-invitations/answer` | holder of a role invitation token (not agents) | `{token, answer, displayName?, languages?, maxLoad?}`; the role goes to the invited address |

"Chair or admin (human)" is as in spec 02, §2.2: a chair, an admin or a site admin, in person. A draft conference the caller cannot see answers 404; everyone else is refused with 403, an agent included, whatever its tier. The routes that change something count toward the person's 60 writes a minute.

## 3. Order of work

Each step is one pull request that leaves the app usable.

1. Chairs do everything: permissions, and the phase control on "Manage submissions".
2. Settings, part two: review settings and reviewer guidelines.
3. Settings, part two: email texts, then agreements.
4. People and invitations.
5. Assignments.
6. "My reviews" and the review form, with the day reviews are due and each person's email choices.
7. Decisions, and sending them.

Small fixes that need none of this: [#29](https://github.com/AMSUCF/ELOchair/issues/29) (the chair's proposal page).

## 4. Acceptance

- [ ] Starting from a closed call, a chair invites two reviewers, assigns them, reads their reviews, records a decision and sends it, without any command on the server.
- [ ] A reviewer signs in on a phone, finds their assignments, reads the guidelines, saves a draft and sends a review.
- [ ] A reviewer never learns who wrote an anonymized proposal, who else reviews it, or what was decided. An author never learns who reviewed.
- [ ] A chair changes the guidelines, a criterion and the wording of a message in three languages, reviews the changes, saves, and the next reviewer and the next email show them.
- [ ] A reviewer turns their emails down to a daily summary, and gets one.
- [ ] Every screen passes the phone and accessibility checks the existing ones pass, in `en`, `es` and `pt`.

## Open questions

For the conference chair. Each has a default above, so work does not wait on them.

- Are roles needed beyond chair and reviewer (for example a head of each committee)?
- Should authors receive the reviewers' comments with the decision? (Default: yes, without names or scores.)
- Is a waitlist needed? (Default: yes, the status exists.)
- Is the overall recommendation wanted beside the criteria? (Default: yes.)
- Should reviewers of one proposal see each other's reviews once theirs is sent? (Default: no.)

## Deferred

- **Suggested or automatic assignment**, by load, language and expertise. The local embedding worker of spec 01 belongs here.
- **Discussion among reviewers**, and rebuttals from authors.
- **Track chairs**, until a conference has tracks ([#28](https://github.com/AMSUCF/ELOchair/issues/28)).
- **Scheduling and the public program.**
