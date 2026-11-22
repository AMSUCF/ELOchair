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
    - A proposal that its reviewers no longer read (a withdrawn one) is not counted either: it is nobody's work.
  - track chairs, where a conference has any: they can be removed and never added (§1.1);
  - the invitations that are waiting, were declined or have expired, with when they were sent.
  - A site admin holds no role at the conference and is not listed.
- **A review pool is called a committee** wherever a person reads it on the People page, on the invitation page and in the emails, in the three languages. In the code, the API and the configuration it stays a pool, and so it does on the settings screen.
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
  - The page needs no account. Its heading says the role ("You are invited to review", "You are invited to be a chair"). Under it the page says which conference, for a reviewer which committees, which address was invited, and in a sentence or two what accepting means. It has two actions, Accept and Decline. It never shows the name the chair typed. While the link is being read, and when it no longer works, the heading names no role.
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
  - Removing a reviewer also releases, in the same transaction, every assignment that person has at the conference, with the reason `role_removed` (§1.3: each is recorded, and none is left), and deletes their `reviewer_profiles` row. Nothing else of theirs is touched. (There are no reviews yet; step 6 decides what becomes of a sent review.)
    - Invited again and a reviewer again, they get none of those proposals back by that: a chair assigns them again (§1.3).
    - The confirmation says how many proposals lose the reviewer, counted as the page counts them. The request names that number and removes nothing if it is no longer true (409 `stale`).
  - Removing a chair removes both the `chair` and the `admin` role. The invitations that chair sent stay the conference's: the chairs who remain see them in the list and can cancel them, and the confirmation says so.
  - **A chair cannot remove their own chair role**, on the page or through the API (409 `own_role`), so a conference always has a chair. Two chairs removing each other at the same moment cannot both succeed: the second finds that it is no longer a chair.
    - Whose role it is, is read from the role's own rows, never from the id as it was typed in the address: an id in capitals names the same person to the database, and to this rule.
  - **Every change reads the chair again inside its transaction**, under a lock on the conference's roles: someone removed while their request was on its way invites, sends again, cancels and removes nothing (403). The same holds for a configuration save and a phase move. Once a removal has committed, nothing that person began as a chair commits afterwards; the rule, and the one order in which locks are taken, are in spec 02, §1.9.
  - A reviewer's pools are not edited after they accept: remove them and invite them again.
- The server's `grant` command still gives any role, as before.
- **Audit.** One row per invitation sent, sent again, cancelled, accepted and declined (`role_invitation.sent`, `.resent`, `.cancelled`, `.accepted`, `.declined`), and per role removed (`role.removed`). Each holds IDs, the role, the pools and counts, and nothing else. A reviewer's removal also writes one `assignment.released` row for each assignment it releases (§1.3).

### 1.3 Assignments
- **Who assigns.** A chair of the conference, in person, by hand, one reviewer at a time, on the proposal's page. Never an agent, whatever its tier, and never a track chair.
  - A chair cannot assign, release or see the reviewers of their own proposal, or of one they have a conflict with (spec 01's conflict rule, unchanged): reviewers are managed only by a chair who is given the proposal as a chair (`submissionAccess(...) === "chair"`, with `canManagePeople`; together `canManageReviewers` in `packages/policy`). Every route and every view below goes through it.
  - For such a proposal the routes about one proposal answer 404 `not_found`, as they do for a draft, another conference's proposal and one that does not exist.
- **Which proposals take a reviewer.** Only one that has been submitted and is still under consideration: status `submitted`, and nothing else.
  - A draft and a withdrawn proposal never do. The other statuses an assigned reviewer can still read (`accepted`, `waitlisted`, `rejected`, `confirmed`) all carry a decision: the reviewers a proposal has keep it, and nobody new is asked to judge what has been judged. Step 7 (decisions) may widen this if a recorded decision is to be taken back for another review.
  - A proposal that takes no new reviewer can still lose one it has.
- **From when.** A chair assigns once the call has closed (`callState(...) === "closed"`): its closing date has passed, or the conference is in a later phase. Before that the page says so and offers nobody (409 `call_not_closed`).
- **Reviewers read once the phase is `reviewing`.** An assigned reviewer opens the proposal while the conference is in `reviewing` or a later phase. Before that they get what a stranger gets (404), in the list as on the proposal's page. The policy learns the phase from its context (`SubmissionContext.phase`, which the server's loader takes from the conference's row). So a chair can assign in the days between the closing date and the move to review, and nothing is read early.
- **Who is offered.** The reviewers of the pool that reviews the proposal's format (`reviewPool`). A reviewer's role names their pools in its scope, and a role without a scope is every pool. Each is shown with their name and address, the languages they said they review in, and their load: "n assigned of m", where m is the most they said they would take (`reviewer_profiles.max_load`; a reviewer given the role on the server said nothing, and is shown without it).
  - **The load is the People page's number** (§1.2, `assignedCount`): it counts the proposals the chair who is looking manages. A chair's own proposals and conflicts are left out, so no number says who reviews them. A withdrawn proposal is not counted.
  - **Never offered, and refused by the server if asked for** (409 `not_offered`, which never says why):
    - the proposal's own people: anyone on it, whatever their status (invited, confirmed, or having declined);
    - anyone with a conflict with the proposal or with one of its people (the `conflicts` table, read by the same `isConflicted` that decides who may read a proposal);
    - anyone who was released from it because of a conflict (below);
    - anyone who is not a reviewer of that pool.
  - Someone already assigned to it is not offered either: 409 `already_assigned`.
  - **A reviewer who has reached their number** is still offered, listed after the others with a line that says so. Assigning them asks first, in place: the number is what they offered, not a lock. The server holds to that too: without `confirmedFull` in the request it assigns nobody who is full (409 `reviewer_full`, with their numbers as that chair may know them), so nobody goes over their number unasked because a page was out of date.
- **The proposal's page**, as a chair is given it, gains a **Reviewers** section, for a chair of the conference:
  - a sentence that says what assigning does: the reviewer will be able to read the proposal once the conference is in review (or, once it is, from then on), anonymized or with the authors' names as its format is reviewed; and that nobody is emailed when a reviewer is assigned or removed. (Emails about assignments come with step 6; the page promises none.)
  - how many reviewers the proposal has against how many its pool asks for (`reviewsPerSubmission`), and the pool's name;
  - the reviewers assigned, each with when, and **Remove from this proposal**, which asks first, in place, and says what will happen;
  - **Assign a reviewer**: the list above. A list of more than eight has a box to find someone by name or address.
  - A link that leads to the section (`…/s/:id#reviewers`) puts focus on its heading.
  - **Someone assigned who can no longer review it** is still listed, with a line that says so, and is not counted among its reviewers, here or on the Assignments page. That is someone who has since become one of the proposal's people, has a conflict with it recorded since, or no longer reviews for the pool that reviews its format (`couldReview`). Their assignment stands until a chair removes them; they read nothing as its reviewer meanwhile.
  - A track chair is given the proposals of their tracks as a chair, with the ids of their reviewers (`assignedReviewerIds`), as before this step. The Reviewers section, with names and with assigning, is not theirs.
- **A proposal that has had a reviewer keeps its format.** Its format decides which pool reviews it and what its reviewers are shown. An owner can take a submitted proposal back to a draft only while the call is open (spec 02, §1.3), which after an assignment means that the chairs opened the call again. From then on the owner's edit refuses another format (422 at `typeKey`, code `locked`, as for a submitted proposal), whether its reviewers are still assigned or were released. Otherwise it could be sent in again in a format that shows the authors to someone who was given it as anonymized: what the guard on anonymity refuses in the settings. Everything else about it can still be changed, and it is sent in again in the format it had. The refusal says only that the format is locked.
- **Releasing.** Removing a reviewer from a proposal releases the assignment: the assignment is deleted from `assignments`, and a record of it is written to `assignment_releases`, in the same transaction. The record holds what the assignment was (the conference, the proposal, the reviewer, who assigned and when), who released it where a person did, when, and why.
  - **`assignments` holds the assignments that stand, and nothing else**, as it always has. So whatever reads it reads the ones that count, in this version of the app and in every earlier one: going back a version cannot give a released reviewer their proposal back. One function releases (`releaseAssignments`), for a chair's removal and for a role's.
  - The reasons: `chair` (a chair removed them), `conflict` (the reviewer said they have a conflict of interest, or know whose work it is), `expertise` (outside what they can judge), `time` (no time), `role_removed` (their reviewer's role was removed, §1.2). This step produces the first and the last. The three a reviewer gives belong to "I cannot review this", below.
  - **Released means gone, everywhere.** The reviewer gets what a stranger gets (404), a chair's view of the proposal and a chair's agent no longer name them, and the People page, the loads and the Assignments page no longer count them: there is no assignment left to read.
  - **Assigned again**, a released reviewer gets a new assignment, made at that moment, by that chair. There is one assignment for a reviewer and a proposal at a time, and one record for each release.
  - **Except after a conflict.** A reviewer released because of a conflict is never offered for that proposal again.
  - **The record is read for three things only**, all in `services/assignments.ts`, and all of them ids: who left a proposal because of a conflict; which proposals have ever had a reviewer, for the guard on anonymity; and whether one proposal has, for the rule that it then keeps its format. Nothing that decides who may read, and nothing that counts, reads it.
  - **The guard on anonymity still counts a released assignment** (spec 02, §1.9). That guard promises authors that nobody who is given their proposal as anonymized is later shown who wrote it. A released reviewer may have read it anonymized, and can be assigned to it again. If a release took the proposal out of the guard, a chair could release its reviewers, show names, and assign the same people again. So the guard reads both tables (`everAssigned`): who is assigned, and who was. It stays one way: removing the reviewers does not undo it.
  - **What the record survives.** It goes with its proposal, as the proposal's assignments do: an owner deleting a draft never fails on it, and nothing is left of a proposal that is gone (what the guard remembered was about that proposal). It outlives the people it names: if a person's record is ever deleted, their id in it becomes null and the record stays, so the proposal keeps the fact that it has had a reviewer.
- A reviewer can say **"I cannot review this"**, with a reason and an optional note for the chairs. The reasons: a conflict of interest (or they know whose work it is), outside what they can judge, or no time. The proposal leaves their list and they do not see it again, a conflict is recorded when that was the reason, and the chairs are told. (Step 6 builds it; its reasons are in the data already.)
- An **Assignments** page (`/:lang/c/:slug/assignments`, linked from "Manage submissions") is for the conference's chairs, in person. By pool, it lists every proposal that takes reviewers (status `submitted`) with its format, how many reviewers it has of those the pool asks for, and their names. Those still short come first and are marked ("Needs 2 more"). Each pool has a line of totals: how many proposals, and how many are still short.
  - Each proposal links to its page, where assigning happens. The page assigns nothing and suggests nothing.
  - Proposals the chair does not manage (their own, conflicts) are not listed. The page says how many were left out, and nothing else about them.
  - While the call has not closed, the page says that nobody can be assigned yet, and lists what has been submitted so far.
  - **A long list comes a page at a time**, pool by pool (50, "Show more"), as "Manage submissions" does. The cursor is the sealed position after the last proposal shown: short ones first, then by when a proposal was created, then by its id. It is compared, never looked up, and opens only on that pool's list for that person.
- **Locks.** Assigning and releasing are a chair's writes (spec 02, §1.9). Each takes the proposal's row (for no key update: spec 02, §1.9 says why), then the conference's roles lock shared, with the chair read again under it (`stillChair`), then the conference's row shared (`shareConference`).
  - Two chairs assigning the same reviewer to a proposal at once make one assignment: the second finds it there (409 `already_assigned`).
  - Removing a reviewer's role takes the roles lock exclusive, so it runs wholly before or wholly after an assignment of that reviewer: after, it releases the assignment; before, there is no reviewer left to assign. Nobody who is not a reviewer is left with an active assignment.
  - A settings save that would show names holds the conference's row, so it and an assignment wait for each other, and the save's guard never misses one.
  - Two chairs assigning one reviewer to two different proposals at the same moment can take that reviewer one past their number without the question being asked. The number is not a lock.
- **Audit.** One row per assignment made (`assignment.made`) and per release (`assignment.released`), on the submission, with the reviewer's id, and for a release its reason. Never a name or a text.
- There is no automatic or suggested assignment in this version, and no assignment in bulk.

### 1.4 Reviews
The reviewer's part, from the invitation (§1.2) to the last review, is three screens: a list, a proposal with its form, and their email choices (§1.7).

- **"My reviews"** is the list. It shows the day reviews are due, how many of the reviewer's own are sent, drafts or not started, the chairs' guidelines for the pool, and each proposal assigned to them with its format, its language and that status. A reviewer sees only their own assignments.
- **One page per proposal**: the proposal as the reviewer projection gives it (§1.5), the guidelines again, and under it **one form**:
  - a score for each of the pool's criteria, on that criterion's scale, with the criterion's description where the chairs wrote one
  - comments for the authors (required)
  - a note for the chairs only (optional)
  - an overall recommendation: accept, unsure or reject
- A review is saved as a draft, then sent. **The chairs see a review only once it is sent**: a draft is the reviewer's own.
- **A sent review can be changed, and a late one sent, for as long as the conference is in `reviewing`.** The day reviews are due is shown on the list and sets the reminder (§1.7); it locks nothing. The chairs end reviewing by moving the phase, and from then on reviews are read-only.
- Unsaved text is kept in the browser as it is for proposals (spec 02).
- **The form is the chairs' to word** (§1.8): every limit and every description a reviewer meets on it is a setting. The screens show the standard wording until a chair writes their own.

### 1.5 Anonymity
- **What a reviewer sees of a proposal** is the existing reviewer projection: the format's blind mode decides whether authors are named. For ELO 2027 the scientific committee reviews anonymized and the artistic committee sees names.
- **Reviewers are never named** to authors, in any mode, in the app or in email.
- **Reviewers do not see each other.** A reviewer sees their own review of a proposal and nothing about who else reviews it or what they wrote.
- **Reviewers do not learn the outcome** from the app: not the decision, and not the other reviews, before or after it.
- **Chairs see reviews and who wrote them**, once sent, except for their own proposals and conflicts, where they see neither.
- **Authors receive** the comments written for them, without names and without scores, when decisions are sent (§1.6).
- Every new view is an allow-list projection in `packages/policy`, with `findLeaks()` tests. Audit rows hold IDs and enum values only, never review text.

### 1.6 Decisions
- A chair **records** accept, waitlist or reject on the proposal's page, with the reviews beside it. Recording tells nobody and can be changed.
- **Sending decisions is its own step.** The chair sees the message for each outcome, how many proposals and people get each, and confirms. Nothing is sent without that confirmation (house rule 5). Sent decisions are final in the app.
- **The phase** is moved by a chair from "Manage submissions", one step at a time. The control says what the phase does, in a sentence, and asks for confirmation. Going back needs a reason, as now. A step is refused if the conference has left the phase the page showed.

### 1.7 Email
- **The whole list of messages:**
  - to a person: the invitation to be a reviewer or a chair
  - to a reviewer: new assignments; one reminder before reviews are due, listing what they have not sent yet (three days before, unless the chairs set another number)
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

- **Review**, for each pool: its name, whether authors are named to reviewers, reviews per proposal, the reviewer guidelines (a text per language), the day reviews are due, and how many days before it the reminder goes out.
- **The review form**, for each pool. Every number and every description a reviewer meets on the form is a setting:
  - each criterion: its label, an optional description (what it asks, or what its lowest and highest scores mean), and its smallest and largest score
  - the comments for the authors: the description under the field, and its fewest and most words
  - the note for the chairs: its description, and whether the form has one
  - the recommendation: its description, and whether the form has one
  - Labels and descriptions are texts per language. The names of the three fixed fields and of the three recommendations are the app's own, in its three languages, so that every screen and every export means the same thing by them.
- **Emails**: for every message in §1.7 and in spec 02, the subject and the body per language, with a fixed set of named placeholders such as `{title}` and `{deadline}`, a preview with sample data, and "back to the default text". The sign-in email is fixed.
- **Agreements**: title, text, link and version.
- **Guardrails**, each refused in the review step with the reason beside the value:
  - naming authors to a pool that reviewed anonymized, once that pool has an assignment
  - removing a criterion that has scores, or narrowing a scale below a score already given (relabelling is always allowed)
  - a limit on the comments that a review already sent does not meet, or taking the note or the recommendation off a form that has answers to it (sent reviews stay valid, as submitted proposals do: spec 02, §1.9)
  - a placeholder the message does not have, or a text missing in the conference's main language
- Changes stay human-only and audited, like every configuration change.

## 2. Contracts

Shapes start in `packages/schema` (house rule 1). Additions, all optional so that stored configurations stay valid:

- `reviewPools[].guidelines`: text per language.
- `deadlines.reviewsDue`: a date and time, after `submissionsClose` and before `notification`.
- `messages`: by message key, a subject and a body per language. An absent key means the default text, which lives with the code in three languages.
- Tables: `reviews` (one per assignment: scores, both texts, recommendation, draft or sent, times), `notification_choices` (person, conference, the three choices above).
- Projections: a review as its reviewer, as a chair and as an author sees it.

Built in step 4 (§1.2):

- Messages: `reviewer_invitation` (placeholders `{committees}`, `{conference}`, `{link}`) and `chair_invitation` (`{conference}`, `{link}`). In both, `{link}` is required and stays out of the subject.
- Tables, both new (migration `0007_people_invitations`, which changes no existing table):
  - `role_invitations`: what the chair typed (address, name), the role, the pools, the language, the hash of the link's token, the person row of the address, who invited, when it was last sent and when it expires, when it was answered and how, when it was cancelled. Rows are kept: an answer or a cancellation is recorded, never deleted.
  - `role_invitation_sends`: one row per email sent (who sent, to whom, when, first or again), for the daily limits. IDs only.
- Projections, in `packages/policy`: `projectPeople()` (the People page, for a chair in person) and `projectRoleInvitation()` (the invitation page, for whoever holds the link, never an agent).
- Constants: `ROLE_INVITATIONS` in `packages/schema` holds the 30 days, the limits and the range of a reviewer's load, so that the pages say the numbers the server enforces.

Built in step 5 (§1.3):

- Tables (migration `0008_assignment_releases`, which only adds):
  - `assignments` gains one nullable column, `assigned_by_person_id` (the chair who made it; null on rows from before, and on seeded ones). Nothing else about the table changes: it holds the assignments that stand.
  - `assignment_releases` is new: one row per release. `conference_id` and `submission_id` (both cascade), `reviewer_id`, `assigned_by_person_id` and `released_by_person_id` (each set to null if that person is deleted), `assignment_id` (the id the assignment had; no foreign key, the row is gone), `assigned_at`, `released_at`, and `reason` with its check (`chair`, `conflict`, `expertise`, `time`, `role_removed`).
- Schema: `Assignment` (with `assignedByPersonId`), `AssignmentRelease`, `AssignmentReleaseReason`, the inputs `AssignReviewerInput`, `AssignmentsQuery` and `AssignmentsPoolQuery`, and `reviewersCanRead(phase)`.
- Policy, in `packages/policy` (`assignments.ts`): `canManageReviewers`, `underConsideration`, `takesReviewers`, `reviewerOffer`, `couldReview`, and the projections `projectProposalReviewers()` (the Reviewers section) and `projectAssignments()` (the Assignments page). `SubmissionContext` gains `phase`.

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
| `GET /api/conferences/:slug/assignments` | chair or admin (human) | `projectAssignments()`: by pool, the proposals that take reviewers, with their reviewers and totals; `limit` (50) of each pool, and its `nextCursor`; `excluded` counts the chair's own and conflicted ones |
| `GET /api/conferences/:slug/assignments/pools/:pool` | chair or admin (human) | one pool's next page: `cursor`, `limit`; 400 at `cursor` for one that does not open; 404 for a pool the conference does not have |
| `GET /api/conferences/:slug/assignments/submissions/:id` | chair or admin (human) who manages the proposal | `projectProposalReviewers()`: who reviews it, whether it takes a reviewer now (`takes`), and who can be assigned; 404 for a proposal the chair does not manage |
| `POST /api/conferences/:slug/assignments/submissions/:id/reviewers` | chair or admin (human) who manages the proposal | `{reviewerId, confirmedFull?}`; 204; 404 as above; 409 `call_not_closed`, `not_under_consideration`, `already_assigned`, `not_offered` or `reviewer_full` (with `assigned`, `maxLoad`) |
| `DELETE /api/conferences/:slug/assignments/submissions/:id/reviewers/:reviewerId` | chair or admin (human) who manages the proposal | releases the assignment (reason `chair`); 204; 404 as above, and for someone who is not reviewing it |

"Chair or admin (human)" is as in spec 02, §2.2: a chair, an admin or a site admin, in person. A draft conference the caller cannot see answers 404; everyone else is refused with 403, an agent included, whatever its tier. The routes that change something count toward the person's 60 writes a minute. "Who manages the proposal" is §1.3: the chair is given it as a chair, so not their own, and not one they have a conflict with.

## 3. Order of work

Each step is one pull request that leaves the app usable. Steps 1 to 4 are done (#35, #38, #39, #40, #43), and so is step 5, with the pull request that brought §1.3 into line with it.

1. Chairs do everything: permissions, and the phase control on "Manage submissions".
2. Settings, part two: review settings and reviewer guidelines.
3. Settings, part two: email texts, then agreements.
4. People and invitations. (Done.)
5. Assignments. (Done.)
6. "My reviews" and the review form, with the day reviews are due and each person's email choices.
7. Decisions, and sending them.

Small fixes that need none of this: [#29](https://github.com/AMSUCF/ELOchair/issues/29) (the chair's proposal page).

## 4. Acceptance

- [ ] Starting from a closed call, a chair invites two reviewers, assigns them, reads their reviews, records a decision and sends it, without any command on the server.
- [ ] A reviewer signs in on a phone, finds their assignments, reads the guidelines, saves a draft and sends a review.
- [ ] A reviewer never learns who wrote an anonymized proposal, who else reviews it, or what was decided. An author never learns who reviewed.
- [ ] A chair changes the guidelines, a criterion's label, description and scale, the description and the word limits of the comments, and the wording of a message, reviews the changes, saves, and the next reviewer and the next email show them.
- [ ] A reviewer sends a review after the day reviews were due, while the conference is still in review, and it counts.
- [ ] A reviewer turns their emails down to a daily summary, and gets one.
- [ ] Every screen passes the phone and accessibility checks the existing ones pass, in `en`, `es` and `pt`.

## Open questions

For the conference chair. Each has a default above, so work does not wait on them.

- Are roles needed beyond chair and reviewer (for example a head of each committee)?
- Is a waitlist needed? (Default: yes, the status exists.)

**Settled by the organizers on 2026-11-21**, with the reviewer screens in front of them; the conference chair may still change any of it:

- Authors receive the reviewers' comments with the decision, without names and without scores.
- The form has an overall recommendation beside the criteria, unless the chairs take it off (§1.8).
- Reviewers of one proposal never see each other's reviews.
- Late reviews count until the chairs move the phase.

## Deferred

- **Suggested or automatic assignment**, by load, language and expertise. The local embedding worker of spec 01 belongs here.
- **Discussion among reviewers**, and rebuttals from authors.
- **Track chairs**, until a conference has tracks ([#28](https://github.com/AMSUCF/ELOchair/issues/28)).
- **Scheduling and the public program.**
