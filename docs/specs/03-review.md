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
- A **People** page lists who holds a role in the conference: chairs, and reviewers by pool, each with how many proposals they have and how many reviews they have sent.
- A chair **invites** someone by email, as a reviewer for one or more pools or as a chair. The email carries a link, in the language the chair picks.
  - Accepting gives the role. A reviewer then says which languages they read and the most proposals they will take.
  - Declining tells the chairs. An invitation can be sent again, at most once an hour, and it expires with the review.
  - Invitations protect the invitee as proposal invitations do (spec 02, §1.2): nobody learns from the app whether an address has an account.
- A chair **removes** a role. A reviewer's assignments without a sent review are released; sent reviews stay.
- A chair cannot remove their own role, so a conference always has a chair.

### 1.3 Assignments
- A chair assigns reviewers **by hand**, on the proposal's page. The list offers the reviewers of that format's pool, with each one's load beside the most they said they would take.
- **Never offered:** the proposal's own people, anyone with a conflict (spec 01), and anyone who said they cannot review it.
- An **Assignments** page shows, by pool, each submitted proposal with the reviews it has against the number the pool asks for, so that gaps are plain.
- Only submitted proposals can be assigned. A chair can assign from the day the call closes. Reviewers can open their assignments once the phase is `reviewing`.
- A reviewer can say **"I cannot review this"**, with a reason and an optional note for the chairs. The reasons: a conflict of interest (or they know whose work it is), outside what they can judge, or no time. The proposal leaves their list and they do not see it again, a conflict is recorded when that was the reason, and the chairs are told.
- A chair cannot assign or see the reviewers of their own proposal, or of one they have a conflict with (spec 01's conflict rule, unchanged).
- There is no automatic assignment in this version.

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
- Tables: `reviews` (one per assignment: scores, both texts, recommendation, draft or sent, times), `role_invitations` (like `invitation_tokens`), `notification_choices` (person, conference, the three choices above). `assignments` gains who made it and when it was released.
- Projections: a review as its reviewer, as a chair and as an author sees it.

Routes are written into this section as each part is built, in the form of spec 02, §2.2.

## 3. Order of work

Each step is one pull request that leaves the app usable. Steps 1 to 3 are done (#35, #38, #39, #40).

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
