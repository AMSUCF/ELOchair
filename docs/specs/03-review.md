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
  - the reviewers, under each review pool they belong to, each with the number of proposals assigned to them, how many of those have a review of theirs that was sent (§1.4), and what they said when they accepted (the languages they review in, the most proposals they will take).
    - Both numbers count the proposals the chair who is looking manages as a chair. Their own proposals and those they have a conflict with are left out: a chair may not learn who reviews their own work (§1.3), or that it has been reviewed, and a count would give it away.
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
  - Removing a reviewer also releases, in the same transaction, the assignments that person has at the conference, with the reason `role_removed` (§1.3: each is recorded), and deletes their `reviewer_profiles` row.
    - **A review they sent stays, and so does the assignment it belongs to.** A sent review is part of its proposal's record (§1.4): the chairs go on reading it, under its reviewer, who is shown as no longer reviewing the proposal. Only assignments without a sent review are released, and a review that was begun and not sent goes with its assignment. Nothing else of theirs is touched.
    - Without the role they read nothing, the proposals they reviewed included. Invited again and a reviewer again, they have the proposals they sent a review of, and none of the others: a chair assigns those again (§1.3).
    - The confirmation says how many proposals lose the reviewer and how many keep a review of theirs, counted as the page counts them, and that drafts are discarded. The request names both numbers (`assignments`, `reviews`) and removes nothing if either is no longer true (409 `stale`, with both as they are).
  - Removing a chair removes both the `chair` and the `admin` role. The invitations that chair sent stay the conference's: the chairs who remain see them in the list and can cancel them, and the confirmation says so.
  - **A chair cannot remove their own chair role**, on the page or through the API (409 `own_role`), so a conference always has a chair. Two chairs removing each other at the same moment cannot both succeed: the second finds that it is no longer a chair.
    - Whose role it is, is read from the role's own rows, never from the id as it was typed in the address: an id in capitals names the same person to the database, and to this rule.
  - **Every change reads the chair again inside its transaction**, under a lock on the conference's roles: someone removed while their request was on its way invites, sends again, cancels and removes nothing (403). The same holds for a configuration save and a phase move. Once a removal has committed, nothing that person began as a chair commits afterwards; the rule, and the one order in which locks are taken, are in spec 02, §1.9.
  - A reviewer's pools are not edited after they accept: remove them and invite them again.
- The server's `grant` command still gives any role, as before.
- **Audit.** One row per invitation sent, sent again, cancelled, accepted and declined (`role_invitation.sent`, `.resent`, `.cancelled`, `.accepted`, `.declined`), and per role removed (`role.removed`). Each holds IDs, the role, the pools and counts (for a reviewer: the assignments released, and the reviews kept), and nothing else. A reviewer's removal also writes one `assignment.released` row for each assignment it releases (§1.3).

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
  - a sentence that says what assigning does: the reviewer will be able to read the proposal once the conference is in review (or, once it is, from then on), anonymized or with the authors' names as its format is reviewed; and a second that says who is told by email (§1.7): a reviewer who is assigned, as often as they have chosen, once the conference is in review, and nobody when a reviewer is removed. Once the conference has left review it says that nobody is emailed.
  - how many reviewers the proposal has against how many its pool asks for (`reviewsPerSubmission`), and the pool's name;
  - the reviewers assigned, each with when, whether their review is sent and when, and each sent review in full (§1.4);
  - **Remove from this proposal**, which asks first, in place, and says what will happen, the discarding of a draft included. It is not offered for a reviewer whose review is sent, and a sentence says why: a sent review is part of the proposal's record (409 `review_sent` if asked for all the same);
  - who said they could not review it, with the reason and their note;
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
  - **The record is read for four things only**, all in `services/assignments.ts`. Three are ids: who left a proposal because of a conflict; which proposals have ever had a reviewer, for the guard on anonymity; and whether one proposal has, for the rule that it then keeps its format. The fourth is for the chairs who manage a proposal, on its page: who said they could not review it, with their reason and their note. Nothing that decides who may read, and nothing that counts, reads it.
  - **A release keeps reviews in step.** One function releases, and it is what ties the two tables together (§1.4): a release takes the reviewer's draft with it, and an assignment whose review was sent is never released, whoever asks.
  - **The guard on anonymity still counts a released assignment** (spec 02, §1.9). That guard promises authors that nobody who is given their proposal as anonymized is later shown who wrote it. A released reviewer may have read it anonymized, and can be assigned to it again. If a release took the proposal out of the guard, a chair could release its reviewers, show names, and assign the same people again. So the guard reads both tables (`everAssigned`): who is assigned, and who was. It stays one way: removing the reviewers does not undo it.
  - **What the record survives.** It goes with its proposal, as the proposal's assignments do: an owner deleting a draft never fails on it, and nothing is left of a proposal that is gone (what the guard remembered was about that proposal). It outlives the people it names: if a person's record is ever deleted, their id in it becomes null and the record stays, so the proposal keeps the fact that it has had a reviewer.
- A reviewer can say **"I cannot review this proposal"**, on a page of its own that says what doing so does, with a reason and an optional note for the chairs (at most 2,000 characters). The reasons: a conflict of interest (or they know whose work it is), outside what they can judge, or no time.
  - It releases the assignment through the same function as every release, with that reason, the note, and the reviewer as the one who released it. Their draft goes with it.
  - With a conflict as the reason, a conflict between that reviewer and the proposal is recorded (`conflicts`: kind `declared`, declared by the reviewer), so that the policy never gives them the proposal again and no chair is offered them for it. With the other two a chair can assign them again.
  - The proposal leaves their list, and they get of it what a stranger gets (404). (A chair who also reviews still reads it as a chair, unless the reason was a conflict; the page says so before they tell the chairs.) The chairs who manage it see who said so, why, and the note, on its page; and they are told by email that a proposal was given back, with the reason in the app's words and never the note (§1.7). The page says so before the reviewer tells them.
  - It is offered while the conference is in `reviewing` and until their review is sent. After that it is refused (409 `review_sent`): they change the review, or write to the chairs.
- An **Assignments** page (`/:lang/c/:slug/assignments`, linked from "Manage submissions") is for the conference's chairs, in person. By pool, it lists every proposal that takes reviewers (status `submitted`) with its format, how many reviewers it has of those the pool asks for, how many reviews of it were sent, and the reviewers' names. Those still short of reviewers come first and are marked ("Needs 2 more"); then those that have their reviewers and fewer sent reviews than the pool asks for; then the rest. Each pool has a line of totals: how many proposals, how many are still short, and how many still wait for reviews. Drafts are counted nowhere.
  - Each proposal links to its page, where assigning happens. The page assigns nothing and suggests nothing.
  - Proposals the chair does not manage (their own, conflicts) are not listed. The page says how many were left out, and nothing else about them.
  - While the call has not closed, the page says that nobody can be assigned yet, and lists what has been submitted so far.
  - **A long list comes a page at a time**, pool by pool (50, "Show more"), as "Manage submissions" does. The cursor is the sealed position after the last proposal shown: in which of the three parts of the list it is, then when the proposal was created, then its id. It is compared, never looked up, and opens only on that pool's list for that person.
- **Locks.** Assigning and releasing are a chair's writes (spec 02, §1.9). Each takes the proposal's row (for no key update: spec 02, §1.9 says why), then the conference's roles lock shared, with the chair read again under it (`stillChair`), then the conference's row shared (`shareConference`).
  - Two chairs assigning the same reviewer to a proposal at once make one assignment: the second finds it there (409 `already_assigned`).
  - Removing a reviewer's role takes the roles lock exclusive, so it runs wholly before or wholly after an assignment of that reviewer: after, it releases the assignment; before, there is no reviewer left to assign. Nobody who is not a reviewer is left with an active assignment.
  - A settings save that would show names holds the conference's row, so it and an assignment wait for each other, and the save's guard never misses one.
  - A reviewer's own writes (§1.4) take the same three locks in the same order, and read the reviewer again under the roles lock. So a chair removing a reviewer from a proposal waits for a review of it that is being sent, and then finds it sent; a role's removal runs wholly before a review (which then finds no reviewer) or wholly after it (and keeps it); and a save of the settings never misses a review sent at the same moment.
  - Two chairs assigning one reviewer to two different proposals at the same moment can take that reviewer one past their number without the question being asked. The number is not a lock.
- **Audit.** One row per assignment made (`assignment.made`) and per release (`assignment.released`), on the submission, with the reviewer's id, and for a release its reason and whether a draft was discarded with it. A conflict a reviewer declares has a row of its own (`conflict.declared`). Never a name or a text: the reviewer's note is in the record of the release, and nowhere in the audit log.
- **Email.** An assignment that is made, and a proposal that is given back, are recorded in the same transaction as things people are to be told of (§1.7). Neither writes an email itself.
- There is no automatic or suggested assignment in this version, and no assignment in bulk.

### 1.4 Reviews
The reviewer's part, from the invitation (§1.2) to the last review, is three screens: a list, a proposal with its form, and their email choices (§1.7). All three are built, with "I cannot review this proposal" (§1.3).

- **"My reviews"** (`/:lang/reviews`) is the list. The main menu offers it to people who hold a reviewer's role somewhere, and to nobody else. For each conference where they review and reviewers can read (the phase is `reviewing` or later) it shows:
  - the committees they review for;
  - the day reviews are due, where the chairs set one, as the conference states it, and a sentence that says it locks nothing;
  - how many of their own reviews are sent, drafts and not started;
  - the chairs' guidelines for each committee they review for;
  - every proposal assigned to them, with its format, the language of its abstract and where their review stands: drafts first, then those not started, then those sent. Each leads to the proposal's page.
  - A reviewer sees only their own assignments. Nothing on the page says who else reviews anything, and a line says so.
- **One page per proposal** (`/:lang/s/:id`): the proposal as the reviewer projection gives it (§1.5), the guidelines again (one press away), and under it **one form**, the committee's:
  - a score for each of the committee's criteria, on that criterion's scale from its smallest to its largest score, as a row of choices, with the criterion's description where the chairs wrote one. (A scale of more than eleven scores, which the settings allow, is answered by typing the number. The settings put no bound on a scale, and nothing counts through one.)
  - comments for the authors: required to send, within the committee's word limits where it has any;
  - a note for the chairs only: optional, and there only if the committee's form has one;
  - an overall recommendation, accept, unsure or reject: there only if the committee's form has one, and then required to send.
- **A draft, then sent.** "Save draft" keeps whatever is filled in, however incomplete. "Send review" needs everything the form requires, within its limits; what is missing is said beside each field and in a list at the top, as for a proposal.
  - **The chairs see a review only once it is sent.** A draft is the reviewer's own: nothing a chair can read (the proposal's page, the Assignments page, the People page, a review of the settings) says that one exists.
  - A draft may be incomplete; it may not hold what the form has no place for (a score off its scale or for a criterion the committee does not have, a note or a recommendation the form does not have): 422, as on sending.
  - **Once sent, a review stays sent.** The page then shows it as the chairs read it, with when it was sent, and "Change my review". Changing it opens the form again and sends it again, complete: the chairs read the version that was sent until the changed one is, and never half a review. It is not saved as a draft again (409 `already_sent`). The day it was first sent stays; a change shows as one.
  - A save names the version of the review it was made on, as for a proposal: one made on an older version changes nothing (409 `stale`).
- **A sent review can be changed, and a late one sent, for as long as the conference is in `reviewing`.** The day reviews are due is shown and locks nothing. The chairs end reviewing by moving the phase. In any later phase reviews are read-only (409 `not_reviewing` on every write): the reviewer still reads the proposals assigned to them and their own reviews, and a draft that was never sent stays a draft, shown as not sent.
- **Who may write a review:** the person the policy gives a reviewer's view of that proposal (`submissionAccess`: the role, the committee, an assignment that stands, no conflict, a proposal in a status reviewers read), in person, and only while the conference is in `reviewing` (`canWriteReview`). Everyone else gets the answer a missing proposal gets (404): a stranger, the proposal's own people, a chair who is not assigned to it, a reviewer of another committee, one who was released. An agent is refused whatever its tier.
  - **A chair who also reviews** (they hold both roles, and a chair assigned them, or they assigned themselves: §1.3) is the proposal's reviewer like anyone (`isReviewerOf`). They read the proposal as a chair, which shows more than a reviewer's view: the authors, and in the Reviewers section the other reviews that were sent. Their own review is on that page, above the Reviewers section, with the committee's guidelines, and the proposal is on their "My reviews". Never for their own proposal or one they have a conflict with: those are not given to them as a chair either. With "I cannot review this" and a conflict as the reason, the proposal is no longer theirs to read as a chair.
- **Unsaved text** in the form is kept in that browser as it is for a proposal (spec 02): back after a reload or a closed tab, with a notice and a way to discard it; gone on save, on discard and on sign-out, and when the server answers that the proposal is not theirs to review (any more); kept under the reviewer's own id and never shown to another account. What comes back is checked against the form as it is now: a value the form no longer has a place for is left out.
  - It is kept with the version of the review it was typed on. Where the review was saved somewhere else since (another tab, another device), the text still comes back on top of the newer review, and the notice says that it would replace what was saved there: the reviewer checks it and saves or sends, or discards it. It is said again after every reload until they have done one or the other.
- **A sent review is part of the proposal's record.** Its reviewer is not removed from the proposal by a chair, does not give the proposal back, and keeps the assignment when their reviewer's role is removed (§1.2, §1.3). A review goes with its proposal: when an owner deletes a draft proposal, its reviews go with it.
- **The form is the chairs' to word** (§1.8): every limit and every description a reviewer meets on it is a setting. The screens show the standard wording until a chair writes their own.
- **Audit.** One row per save, on the submission: `review.draft_saved`, `review.sent`, `review.changed`, each with the review's id and its version. Never a score, a recommendation or a word of a review.
- **Email.** The review that gives a proposal as many sent reviews as its committee asks for is recorded, in the same transaction, as something the chairs are to be told of (§1.7). Nothing else here leads to an email: not a draft, not a review that is changed, and nothing to the authors.

### 1.5 Anonymity
- **What a reviewer sees of a proposal** is the existing reviewer projection: the format's blind mode decides whether authors are named. For ELO 2027 the scientific committee reviews anonymized and the artistic committee sees names.
- **Reviewers are never named** to authors, in any mode, in the app or in email.
- **Reviewers do not see each other.** A reviewer sees their own review of a proposal and nothing about who else reviews it or what they wrote.
- **Reviewers do not learn the outcome** from the app: not the decision, and not the other reviews, before or after it.
- **Chairs see reviews and who wrote them**, once sent, except for their own proposals and conflicts, where they see neither: not a review, not that one was sent, and not in a number. The settings never tell them either: once the conference has been in review, narrowing the form of a committee that reviews such a proposal, if it was ever submitted, is another chair's to do, whether or not a review of it exists and whichever phase the conference is in (spec 02, §1.9, which also says exactly what that refusal tells a chair).
- **Authors receive** the comments written for them, without names and without scores, when decisions are sent (§1.6). Until that is built they are shown nothing of reviews.
- **Agents are shown nothing of reviews**, whatever their tier. Tier M is for cloud agents and gets no review text and no reviewer's name or address; tier C has no view of reviews yet either. What a chair's agent is given of a proposal is what it was given before: the ids of its reviewers, with the proposal a chair manages.
- **Who reads what of a review:**

  | | Their own review | A sent review of a proposal | A draft | Who reviews a proposal |
  |---|---|---|---|---|
  | The reviewer who wrote it | all of it, sent or not | their own only | their own only | nobody else |
  | Another reviewer of the same proposal | their own | no | no | no |
  | A reviewer who was released, or of another committee | no | no | no | no |
  | A chair who manages the proposal | n/a | all of it, with who wrote it and when | no, nor that one exists | by name |
  | A chair on their own proposal, or with a conflict | n/a | no, nor that one exists | no | no |
  | A track chair | n/a | no | no | by id, as before |
  | The proposal's own people, strangers, the public | n/a | no | no | no |
  | A chair's agent (tier M or tier C) | n/a | no | no | by id, as before |

- Every new view is an allow-list projection in `packages/policy` (`reviews.ts`), with `findLeaks()` tests. Audit rows hold IDs and enum values only, never review text.

### 1.6 Decisions
- A chair **records** accept, waitlist or reject on the proposal's page, with the reviews beside it. Recording tells nobody and can be changed.
- **Sending decisions is its own step.** The chair sees the message for each outcome, how many proposals and people get each, and confirms. Nothing is sent without that confirmation (house rule 5). Sent decisions are final in the app.
- **The phase** is moved by a chair from "Manage submissions", one step at a time. The control says what the phase does, in a sentence, and asks for confirmation. Going back needs a reason, as now. A step is refused if the conference has left the phase the page showed.

### 1.7 Email
- **The whole list of messages:**
  - to a person: the invitation to be a reviewer or a chair (§1.2)
  - to a reviewer: new assignments; one reminder before reviews are due
  - to chairs: a reviewer cannot review a proposal; a proposal has all its reviews
  - to authors: the decision, with the comments for them (step 7; not built)
- **The four emails of the review phase** are messages like every other (`new_assignments`, `review_reminder`, `reviewer_declined`, `reviews_complete`): standard texts in English, Spanish and Portuguese, which the chairs reword on the settings screen (§1.8). Each goes to one person, in the first of the three languages their profile lists.
  - **New assignments**, to a reviewer: how many proposals were assigned to them, the day reviews are due (or that the chairs have set none), and a link to "My reviews".
  - **The reminder**, to a reviewer: the day reviews are due, how many of their reviews are not sent, and the same link.
  - **A proposal given back**, to a chair: how many proposals, the reason in the app's own words (a conflict of interest, outside what they can judge, no time; where there are several, each reason that was given, once), and a link to the Assignments page. Who gave it back, and their note, are on the proposal's page and never in an email.
  - **A proposal has all its reviews**, to a chair: how many proposals, and the link to the Assignments page.
  - **What none of them carries:** a proposal's title, an author, a reviewer's name, a word of a review or of a note. A number, the conference's title, a day, a reason out of three and two links are all there is to put in, and a text that names anything else is refused (§1.8). One text serves an email about one proposal and a summary of several: it says how many.
  - **Every one says why the person got it, in one line, and links to their choices** (`/:lang/me#emails`). Both links are required in a text, stand apart from what is around them, and stay out of the subject.
- **Each person chooses** how much they get, on "Your account", for each conference where it applies:
  - a reviewer, when proposals are assigned to them: an email for each one, one summary a day (which is what holds for someone who has chosen nothing), or no email;
  - a reviewer, the reminder: on (unless they turn it off) or off;
  - a chair, notices about reviewing (the two to chairs, together): each one, one summary a day (unless they choose otherwise), or none. A summary is one email for each of the two kinds, and the page says so.
  - Each part is shown only to someone it applies to: the first two to someone who holds the reviewer's role at that conference, the third to someone who holds the `chair` or the `admin` role there. A site admin who holds no role there is not written to. Nothing is shown for an archived conference.
  - Saving is one press for a conference, and the page says that it is saved. A choice is the person's own: no chair sets it for them, and no agent sees or changes it.
- Invitations and the sign-in email cannot be turned off: without them the person could not take part. The page says so. (Decisions, when they are built, cannot be turned off either.)
- **What is recorded, and when.** What happens is written down when it happens, in the same transaction as what caused it, as a notification for each person to be told: who, which conference, which proposal, what kind, when. No email is made then, and no choice is read.
  - A proposal is **assigned**: one for the reviewer.
  - A reviewer **gives a proposal back**: one for each person who holds the `chair` or the `admin` role at the conference, with the reason.
  - A proposal **has all its reviews**: one for each of the same people, when a review is sent for the first time and the proposal then has exactly as many sent reviews as its committee asks for (`reviewsPerSubmission`). A sent review that is changed adds none, and neither does one more review after the number was reached. (So a proposal that already had the number when the chairs lowered it to that is never announced: the Assignments page shows it.)
  - **Nobody is told of what they did themselves:** a chair who assigns a proposal to themself, a chair who also reviews and gives one back, and a chair whose own review is the one that gives a proposal its number, get no notification of it.
- **One job makes the emails**, in the server, each time its mail timer turns (every half minute), before the outbox is delivered. For each person and each kind of thing waiting for them at a conference it goes by their choice as it is then:
  - **each one:** an email for each proposal, at that run;
  - **one summary a day:** one email that counts everything that has gathered, once the conference's clock (its time zone) has passed 8:00 since the oldest of them was recorded: from 8:00 on, at the next run;
  - **none:** nothing; what waited is marked as answered by no email.
  - What it makes goes to the outbox, and is delivered as every other email is.
  - While everything at a conference waits, the job reads nothing of its proposals.
- **The reminder** is decided by the same job: from 8:00 in the conference's time zone on the day that is three days before the day reviews are due, or the chairs' own number of days (`rules.reviewReminderDays`, 1 to 30, set beside that day on the settings screen). Both days are days of the conference's own calendar. It goes to every reviewer of the conference who then has reviews that are not sent (a draft is not sent) and has not turned it off.
  - No reminder where no day is set, while the conference is not in `reviewing`, and once the day has passed.
  - It is decided once for all of a conference's reviewers together, and remembered for the conference with the day it was for: someone who is given a proposal after it went out is not reminded of that day (the email about the new assignment says the day), and neither is someone who turns the reminder on afterwards. Where nobody had anything left to send, it is decided all the same.
  - **A day the chairs set afterwards is another day.** If they move the day reviews are due, reviewers are reminded of the new day in its turn; at once, where it is already less than that number of days away. So a day that was typed wrong and put right is not the only one reviewers hear of, and a deadline that is extended is announced.
- **Twice, or not at all.** The job may run twice, and may miss a run.
  - A notification is answered once: its mark and the email in the outbox are written in one transaction, on rows that run holds, so a second run finds it answered.
  - The reminder goes out once for a conference and a day: the row that remembers it is written with the reminders, and a second run finds the day in it.
  - A summary whose hour passed while the server was down goes out at the next run; so does the reminder, until the day reviews are due.
  - One conference that cannot be read does not keep the others waiting.
- **What is no longer true when the email is made** is not said. Each notification is asked again, by the policy (`notificationHolds`):
  - A **new assignment** counts only while the person reviews that proposal and reviews can be written: the role, the committee, an assignment that stands, no conflict, a proposal reviewers still read, the conference in `reviewing`. Someone a chair removed from the proposal, or whose reviewer's role was removed, gets no email about it, and a summary counts what is still assigned.
    - **Before the conference is in review** a new assignment waits: the reviewer could not open the proposal yet. Once the chairs move the conference into review, what waited is sent at the next run (for a summary, once 8:00 has passed since it was assigned). The sentence a chair confirms when moving a conference into review says that reviewers are emailed.
    - **Once the conference has left review**, what was never announced is dropped, and so is an assignment made after it: reviews are read then, not written. The Reviewers section says, by where the conference stands, whether a reviewer who is assigned is told by email.
    - A proposal the reviewer has already sent their review of is still counted: it was newly assigned.
  - A **notice to a chair** counts only while the person holds the `chair` or the `admin` role and manages that proposal as a chair (`canManageReviewers`): never their own proposal, and never one they have a conflict with, whether that was so when it happened or has become so since. For such a proposal they get no email, and it is in no number they are sent. Nothing else is asked again: a proposal that was given back and has another reviewer by now was still given back.
  - **What is counted is proposals.** One that was assigned to the same person twice meanwhile is one new assignment; one that two reviewers gave back is one proposal given back, with both their reasons.
  - What no longer holds is marked as answered by no email, and where nothing is left there is no email at all.
  - The job takes none of the locks of §1.3: what it reads may be a moment old.
- **Privacy.** An email goes to one person about their own work at a conference. Reviewers are never named to authors or to each other, and here to nobody: no email names a person. Authors get none of these. Agents get nothing.
- **Audit.** A change of choices is one row (`person.email_choices_changed`, with the values chosen: enumerations and a yes or no). What the job does is one row for each person and kind it answers (`notifications.answered`, with the kind and three numbers, and nobody named: who was written to is in the outbox) and one for a conference's reminder (`review_reminder.sent`, with how many were reminded and the day). Never an address or a text.
- All mail goes through the outbox, as now.

### 1.8 What chairs can edit
A second part of the settings screen, with the same flow as the first (spec 02, §1.9): change, review every change, save, recorded.

- **Review**, for each pool: its name, whether authors are named to reviewers, reviews per proposal, and the reviewer guidelines (a text per language).
- **The day reviews are due**, among the deadlines: optional; when set, after the day the call closes and before the day decisions are sent. Right after it, **how many days before that day reviewers are reminded** (§1.7): optional, a whole number from 1 to 30, and three where it is left empty. Its hint says when the reminder goes out, and that moving the day reminds reviewers again.
- **The review form**, for each pool. Every number and every description a reviewer meets on the form is a setting:
  - each criterion: its label, an optional description (what it asks, or what its lowest and highest scores mean), and its smallest and largest score
  - the comments for the authors: the description under the field (in place of the standard one), and its fewest and most words (both optional)
  - the note for the chairs: its description (in place of the standard one), and whether the form has one
  - the recommendation: an optional description, and whether the form has one
  - Labels and descriptions are texts per language. A description left empty is the app's standard wording, in its three languages, which the settings screen quotes. The names of the three fixed fields and of the three recommendations are the app's own, in its three languages, so that every screen and every export means the same thing by them.
  - A form as the app words it has comments without a word limit, a note and a recommendation: that is what a configuration that says nothing holds.
- **Emails**: for every message in §1.7 and in spec 02, the subject and the body per language, with a fixed set of named placeholders such as `{title}` and `{deadline}`, a preview with sample data, and "back to the default text". The sign-in email is fixed.
  - Each of the four emails of the review phase has its section, with a line that says when it is sent and to whom, and the placeholders it has: `{count}`, `{conference}`, the link `{link}` and the link to the reader's choices `{choices}` in all four; `{due}` (a sentence that says when reviews are due, or that no day is set) in the two to a reviewer; `{reason}` in a proposal given back, with the app's words for the three reasons listed in each language. The hour and the number of days in those lines are the server's own (`REVIEW_EMAILS`).
- **Agreements**: title, text, link and version.
- **Guardrails**, each refused in the review step with the reason beside the value:
  - naming authors to a pool that reviewed anonymized, once that pool has an assignment
  - removing a criterion that has scores, or narrowing a scale below a score already given (relabelling is always allowed)
  - a limit on the comments that a review already sent does not meet, or taking the note or the recommendation off a form that has answers to it (sent reviews stay valid, as submitted proposals do: spec 02, §1.9, which has the list, the paths and the codes)
    - each says how many sent reviews it would leave outside the form. Drafts never block.
    - a review that is kept from the chair asking (their own proposal's, a conflict's) is not read for this at all. Once the conference has been in review (a mark on its row that a move back out of review does not clear), narrowing the form of the committee that reviews such a proposal, if it was ever submitted, is refused to that chair, whether or not a review of it exists: another chair makes the change (spec 02, §1.9).
  - a placeholder the message does not have, or a text missing in the conference's main language
- Changes stay human-only and audited, like every configuration change.

## 2. Contracts

Shapes start in `packages/schema` (house rule 1). Additions, all optional so that stored configurations stay valid:

- `reviewPools[].guidelines`: text per language.
- `deadlines.reviewsDue`: a date and time, after `submissionsClose` and before `notification`.
- `messages`: by message key, a subject and a body per language. An absent key means the default text, which lives with the code in three languages.
- Tables: `reviews` and `notification_choices` (person, conference, the three choices of §1.7), both built: below.
- Projections: a review as its reviewer and as a chair sees it (built: below), and as an author sees it (with decisions).

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

Built in step 6, the screens (§1.4, §1.5, §1.8):

- Configuration, all optional, so that a stored configuration reads as before:
  - `reviewPools[].criteria[].description`: text per language.
  - `reviewPools[].form`: `comments` (`description`, `minWords`, `maxWords`), `chairNote` (`enabled`, `description`) and `recommendation` (`enabled`, `description`). Each part is there once a configuration is read; `enabled` is true unless it says otherwise.
  - `deadlines.reviewsDue`, as above (`reviews_due_order` when it is not between the two).
- Tables (migration `0009_reviews`, which only adds):
  - `reviews` is new: one row for a reviewer and a proposal at most. `conference_id` and `submission_id` (both cascade), `reviewer_id` (no action: a person with a review is not deleted from under it), `version`, `status` (`draft` or `sent`), `scores` (by criterion key), `comments`, `chair_note`, `recommendation` (`accept`, `unsure`, `reject`, or none), `created_at`, `updated_at`, `sent_at` (set exactly when it is sent).
    - A review belongs to a proposal and a reviewer, not to a row of `assignments`: that row is deleted on release, which is what lets every version of the app read `assignments` as the assignments that stand.
  - `assignment_releases` gains one nullable column, `note`: what a reviewer wrote for the chairs when they said they could not review the proposal.
  - `conferences` gains one nullable column, `review_began_at`: when the conference was first found in a phase in which reviewers can read. Set once, by whatever gives a conference its phase (`repo.ts`: `movePhase`, `saveConference`, `createConferenceIfMissing`, and `markReviewBegun` at the start of the server), and never cleared. The guard on the review form's settings decides by it (spec 02, §1.9). The version before neither reads nor writes it.
  - Nothing is written to an existing table that the version before reads differently: a release by a reviewer is a row of `assignment_releases` with a reason that table already had, and a declared conflict is a row of `conflicts` of a kind it already had.
- Schema: `Review`, `ReviewStatus`, `ReviewFormConfig`, the inputs `ReviewInput` and `DeclineReviewInput`, and Zod-free in `reviewForm.ts`: `RECOMMENDATIONS`, `DECLINE_REASONS`, `reviewIssues` (what keeps a review from being sent), `reviewContentIssues` (what a draft may not hold), `fitReview`, `scaleChoices` (a scale as a row of choices, or nothing for one too wide for that).
- Policy, in `packages/policy` (`reviews.ts`): `canWriteReview`, `isReviewerOf` (a reviewer, or a chair who is assigned as one), `reviewsKeptFrom` (whose reviews a person is never shown, whatever their role: the guard on the settings reads none of them), and the projections `projectOwnReview()` (a reviewer's own review) and `projectMyReviews()` (the rows of their list). The chair's view of a proposal's reviews is part of `projectProposalReviewers()` (`assigned[].review`, `otherReviews`, `declined`), and `projectAssignments()` and `projectPeople()` count sent reviews.

Built in step 6, the emails (§1.7):

- Configuration, optional, so that a stored configuration reads as before: `rules.reviewReminderDays`, a whole number from 1 to 30. It is kept among the rules and offered among the deadlines: every reader of `deadlines` takes each of them for an instant.
- Messages: `new_assignments` and `review_reminder` (both `{count}`, `{conference}`, `{due}`, `{link}`, `{choices}`), `reviewer_declined` (`{count}`, `{reason}`, `{conference}`, `{link}`, `{choices}`) and `reviews_complete` (`{count}`, `{conference}`, `{link}`, `{choices}`). In all four `{link}` and `{choices}` are required and stay out of the subject, and none has a placeholder for a name a person typed.
- Tables, all three new (migration `0010_review_emails`, which changes no existing table):
  - `notification_choices`: one row for a person and a conference at most (both cascade), with `assignments` and `chair_notices` (`each`, `daily` or `none`; `daily` unless said otherwise) and `reminder` (true unless said otherwise). No row means the defaults. The row stays when a role goes, and is read only while the role is held.
  - `notifications`: one row for each person to be told of one thing. `conference_id`, `person_id` and `submission_id` (all three cascade), `kind` (`assigned`, `declined`, `reviews_complete`), `reason` (for `declined`: `conflict`, `expertise` or `time`), `created_at`, `status` (`pending`, then `sent` or `dropped`) and `done_at` (set exactly when it is no longer pending). IDs, enumerations and times: nothing a person typed.
  - `review_reminders`: one row for a conference at most (cascade), written with its reminders: `reviews_due` (the day it was for, which is what keeps that day from being announced twice) and `sent_at`.
  - The version before reads and writes none of the three: run on the same database, it sends none of these emails, and what happens meanwhile is not recorded.
- Schema: `NOTICE_FREQUENCIES`, `NOTIFICATION_KINDS`, `NotificationChoices` and its defaults, the input `NotificationChoicesInput`, the constants `REVIEW_EMAILS` (8:00, three days, at most thirty), and Zod-free in `notifications.ts`: `hourOnDay`, `dailyHourAtOrBefore`, `reviewReminderDays` and `reviewReminderWindow`. In `messages.ts`: the app's words for the three reasons (`DECLINE_REASON_WORDS`) and the sentence about the day reviews are due (`reviewsDueSentence`).
- Policy, in `packages/policy` (`notifications.ts`): `emailRoles` (whose these emails are), `projectEmailChoices()` (a person's own choices, for "Your account"), `notificationHolds` (whether something still holds when the email is made), `noticesWait` (whether what waits is left for now, asked before anything of a proposal is read), `planNotices` (what is made of what waits: emails that are a number and reasons, and what is dropped) and `unsentReviews` (what the reminder counts).
- Server: `services/notifications.ts` records (`recordNotifications`) and holds the job (`runNotifications`), which `main.ts` runs on its mail timer, every half minute, before it delivers the outbox.

Routes are written into this section as each part is built, in the form of spec 02, §2.2.

| Route | Who | Notes |
|---|---|---|
| `GET /api/conferences/:slug/people` | chair or admin (human) | `projectPeople()`: chairs, reviewers with their pools and assigned proposals, track chairs, invitations nobody accepted |
| `POST /api/conferences/:slug/people/invitations` | chair or admin (human) | `{email, name?, role, pools?, lang}`; 201 `{id}`; 409 `already_invited` or `already_has_role`; 422 `unknown_pool`; 429 over a limit |
| `POST /api/conferences/:slug/people/invitations/:id/resend` | chair or admin (human) | a waiting or expired invitation; once an hour; a new link replaces the old; 409 `not_waiting`, `pools_gone`, `already_invited` or `already_has_role`; 429 over a limit |
| `POST /api/conferences/:slug/people/invitations/:id/cancel` | chair or admin (human) | any invitation nobody accepted; 409 `already_answered` for an accepted one |
| `DELETE /api/conferences/:slug/people/:personId/roles/:role` | chair or admin (human) | `role` is `chair`, `reviewer` or `track_chair`; a reviewer's removal sends `{assignments, reviews}`; 409 `own_role` or `stale`; 404 when the role is not held |
| `POST /api/role-invitations/info` | holder of a role invitation token (not agents) | `projectRoleInvitation()`: conference, role, pools, the address, `nameNeeded` |
| `POST /api/role-invitations/answer` | holder of a role invitation token (not agents) | `{token, answer, displayName?, languages?, maxLoad?}`; the role goes to the invited address |
| `GET /api/conferences/:slug/assignments` | chair or admin (human) | `projectAssignments()`: by pool, the proposals that take reviewers, with their reviewers and totals; `limit` (50) of each pool, and its `nextCursor`; `excluded` counts the chair's own and conflicted ones |
| `GET /api/conferences/:slug/assignments/pools/:pool` | chair or admin (human) | one pool's next page: `cursor`, `limit`; 400 at `cursor` for one that does not open; 404 for a pool the conference does not have |
| `GET /api/conferences/:slug/assignments/submissions/:id` | chair or admin (human) who manages the proposal | `projectProposalReviewers()`: who reviews it, whether it takes a reviewer now (`takes`), and who can be assigned; 404 for a proposal the chair does not manage |
| `POST /api/conferences/:slug/assignments/submissions/:id/reviewers` | chair or admin (human) who manages the proposal | `{reviewerId, confirmedFull?}`; 204; 404 as above; 409 `call_not_closed`, `not_under_consideration`, `already_assigned`, `not_offered` or `reviewer_full` (with `assigned`, `maxLoad`) |
| `DELETE /api/conferences/:slug/assignments/submissions/:id/reviewers/:reviewerId` | chair or admin (human) who manages the proposal | releases the assignment (reason `chair`) and discards the reviewer's draft; 204; 404 as above, and for someone who is not reviewing it; 409 `review_sent` once their review is sent |
| `GET /api/me/reviews` | signed in (human) | `{conferences}`: `projectMyReviews()` for each conference where the person reviews and reviewers can read; empty for someone who reviews nowhere |
| `GET /api/me/menu` | anyone | `{reviews}`: whether the person signed in holds a reviewer's role somewhere, for the main menu; false for the public and for an agent |
| `GET /api/submissions/:id/review` | the proposal's reviewer (human) | `projectOwnReview()`: their own review, or that it is not started; `open` while the conference is in `reviewing`; 404 for everyone else |
| `PUT /api/submissions/:id/review` | the proposal's reviewer (human), in `reviewing` | `{version, send, scores, comments, chairNote, recommendation}`; the review as it stands; 404 for everyone else; 409 `not_reviewing`, `stale` (with `version`) or `already_sent`; 422 with issues |
| `POST /api/submissions/:id/review/decline` | the proposal's reviewer (human), in `reviewing` | "I cannot review this": `{reason, note?}`; 204; 404 for everyone else; 409 `not_reviewing` or `review_sent` |
| `GET /api/me/notifications` | signed in (human) | `{conferences}`: `projectEmailChoices()` for each conference where the person reviews or chairs and that is not archived; empty for someone who does neither anywhere; 401 for an agent, as for the public |
| `PUT /api/me/notifications/:slug` | signed in (human) who reviews or chairs there | `{assignments?, reminder?, chairNotices?}`, at least one; what is left out stays as it is; the choices as they are afterwards; 404 `not_found` where none of these emails is the person's (no role there, an archived conference, no such conference); 403 `forbidden` for a choice of a role they do not hold there; 403 `agents_read_only` for an agent |

"Chair or admin (human)" is as in spec 02, §2.2: a chair, an admin or a site admin, in person. A draft conference the caller cannot see answers 404; everyone else is refused with 403, an agent included, whatever its tier. The routes that change something count toward the person's 60 writes a minute, a change of email choices included. "Who manages the proposal" is §1.3: the chair is given it as a chair, so not their own, and not one they have a conflict with. "The proposal's reviewer" is §1.4 (`isReviewerOf`): the person `submissionAccess` gives a reviewer's view of it, or a chair who is given it as a chair and is assigned to it as a reviewer of its committee. Whoever is not is answered before any lock is taken. An agent that writes a review is refused as every agent's write is (403 `agents_read_only`); the public must sign in (401).

## 3. Order of work

Each step is one pull request that leaves the app usable. Steps 1 to 4 are done (#35, #38, #39, #40, #43), and so is step 5, with the pull request that brought §1.3 into line with it. Step 6 was done in two pull requests: the screens, and then the emails.

1. Chairs do everything: permissions, and the phase control on "Manage submissions".
2. Settings, part two: review settings and reviewer guidelines.
3. Settings, part two: email texts, then agreements.
4. People and invitations. (Done.)
5. Assignments. (Done.)
6. Reviews, in two parts:
   - the screens: "My reviews", the review form with a draft and then sent, "I cannot review this proposal", the chairs' reading of sent reviews, and the form's settings with the day reviews are due. (Done.)
   - the emails (§1.7): new assignments, the reminder with its number of days, the notices to chairs, and each person's choices. (Done.)
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
