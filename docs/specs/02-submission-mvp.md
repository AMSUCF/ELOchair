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
- **The invitation email** is in the invitee's language. Its wording is the standard text, or the conference's own where its chairs have written one (§1.9). Either way:
  - It can name the owner's display name (one line, with links, bare domains, email addresses and invisible formatting characters removed, until nothing is left to remove), the conference title, the format, the role, and a link. The link is always in it. The name stands as a word of its own, whatever the wording: no text can make it part of a link or an address (§1.9).
  - It contains no submission title, no abstract, and no name the owner typed for the invitee: an invitation has no such value to put into a text, and a text that names one is refused. ELO's signed mail must not carry text an attacker wrote to people who have not agreed to anything.
  - If the proposal is withdrawn while the invitation is pending, the invitee gets a notice without the title, in the invitation's language. So does someone still invited to a draft that is deleted. Neither notice can name anything but the conference.
  - Mail to people who are part of the proposal (receipts, withdrawal notices, answers to the owner) shows owner-written text, such as the title, as typed: one line, without invisible formatting characters, cut with an ellipsis past 300 characters. Titles such as "Poems with p5.js" stay whole.
  - What an owner wrote is cleaned in the same way whatever text it goes into, and it is put in once: a name or a title that holds `{link}` stays those characters.
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
- **The call is open** when the phase is `cfp_open` and the server's receipt time `t` satisfies `submissionsOpen ≤ t < submissionsClose` (`isCallOpen`). There is no grace period, and the client clock never decides anything: the front page and the conference, Start and editor pages follow the `callOpen` the server returns. The server also says where the call stands (`callState`), which is all the public pages say about it (§1.10).
  - Create, edit, invite, remove, return to draft, submit and delete need an open call.
  - **Withdraw** (from `submitted` only) is allowed in phases `cfp_open`, `reviewing` and `deciding`, whether or not the call is open. Withdrawal mail goes to every confirmed contributor and to `contactEmail`, with the proposal's link and, in the standard text, its title; pending invitees get the notice without the title (§1.2).
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
  - A move also records, once and for good, that the conference has been in review (`conferences.review_began_at`, §1.9): when it moves into `reviewing` or a later phase, and when it moves out of one without the mark. A forced move back does not clear it.
  - `seed --force` rebuilds the built-in placeholders and is refused in production.
  - **In the app a chair moves the phase**, from "Manage submissions": one step forward, or one step back. Pressing the button moves nothing. It opens a confirmation in its place that says, in one sentence, what the phase does as the code is today, and has "yes" and "cancel". A step back also asks for a reason (one line, at most 500 characters), sent with `force`. Each step names the phase the page showed (`from`) and is refused if the conference has left it, so a step confirmed on an out-of-date page never becomes a jump. The result is said in a status line, and the page reads the conference again. Chairs, admins and site admins are one group here as everywhere (§1.9); track chairs and reviewers are not offered the control, and agents are refused.
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
- **A reviewer who opens an assigned proposal** gets a read-only page that shows the reviewer projection as it arrives: the text and the answers, and the people only when the review mode shows them, never an email. In anonymized review a line says that names are not shown. Listing assigned work and writing a review belong to the review spec.
  - They can open it once the conference is in `reviewing` or a later phase, and only while the assignment stands: before review, and after a chair has removed them from the proposal, they get what a stranger gets (spec 03, §1.3).
- **`/check`** is for human sessions with `submitter` or `chair` access. It is built by `projectCheck()` in `packages/policy`, not hand-assembled. Agents get 403; reviewers and strangers get 404.
- **Audit details** hold IDs, enum values and the names of changed keys only, never field values, emails or names. The audit log cannot be redacted, so it must never hold content.

### 1.5 Agreements (consent)
- Each conference's configuration lists `agreements`: privacy notice, code of conduct, and recordings policy. Each is localized, versioned, and has a link or text. The link is an https address.
- The owner must acknowledge the current versions to submit; an invitee must acknowledge them to confirm. Each of them is shown the title, the text (with its line breaks) and the link wherever they accept: on submitting, on the invitation page, and when answering an invitation in the app.
- Acknowledgments are stored as `{person, conference, key, version, at}` and audited. This is the "prior, express authorization" Colombia's Ley 1581 requires before processing personal data.
- **What an agreement says changes only together with its version.** A person who accepted `privacy` at version 1 accepted the words it had then. So a save that changes an agreement's title, text or link, in any language, while its version stays the stored one, is refused (§1.9). The new version only has to differ from the stored one; changing the version alone is always allowed. Chairs edit all four on the settings screen.
- **What a new version does,** and does not:
  - Everyone who submits a proposal or confirms an invitation from then on must accept the new version: the acceptance sent with a submit or a confirmation names each agreement's version, and one that names the old version gets 422 `agreements_required`. People are asked every time they submit or confirm, whatever they accepted before.
  - Consent already recorded stays recorded against the old version. Nothing is recorded against the new one until someone accepts it.
  - Nobody is emailed.
  - No proposal already submitted is affected or blocked: acceptance is asked at submitting and at confirming, and is not part of what keeps submitted work valid.
  - A page that was open when the version changed still offers the old one, and is refused until it is reloaded.
  - The rule does not look at earlier versions: going back to one that was used before is allowed, like any version that differs from the stored one. The audit log has what each version said, by the time it was saved.
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
- **Panels** had one session abstract in 2026. ELO 2027's call asks for a rationale and an abstract for each paper: §1.8 says how a panel holds them for now, and [Deferred](#deferred) what is still to come.

### 1.8 ELO 2027's formats
The call was published in November 2026 at <https://elo27.eliterature.org/>. `packages/schema/src/conferences/elo2027.ts` follows it, and `packages/schema/src/elo2027.test.ts` is the record of what it says.

| Format | Abstract | Slot | Review | Also asks for |
|---|---|---|---|---|
| Paper (`talk`) | up to 300 words | 15 min | anonymized | |
| Lightning talk (`lightning`) | up to 150 words | 5 min | anonymized | |
| Panel (`panel`) | rationale, up to 150 words | | anonymized | the abstract of each paper or talk (required); three to 24 people |
| Artist talk (`artist_talk`) | up to 300 words | 15 min | anonymized | |
| Workshop (`workshop`) | description and goals, up to 300 words | 60 min | anonymized | participants expected, 15 to 30 (required); tools and room conditions (required) |
| Reading or performance (`performance`) | up to 300 words | | names visible | technical requirements; a link to the work |
| Work for the exhibition (`exhibition`) | up to 300 words | | names visible | a link to the work |

- **Curatorial pitches** go by email. They are in the configuration as `otherFormats`, which the conference page lists and nothing else uses.
- **Submissions are in English or Spanish** (`languages`). The interface is also in Portuguese.
- **The invitation** (§1.10) is in the configuration too: the line "ELO's first conference in Latin America", the paragraph that invites work on the theme, and three ways to contribute. "Talks & ideas" holds the paper, the lightning talk, the panel and the artist talk; "Art & performance" the reading or performance and the work for the exhibition; "Workshops" the workshop. The wording is the design preview's (`docs/design/visitor-preview/copy.js`), in English and Spanish. Curatorial pitches are in no group.
- **No minimum length.** The call gives only maxima, so its formats have no `minWords`. An abstract must still be there: an empty one is refused with `required`, not `too_few_words`. The interface says "up to 300 words". A format that does set `minWords` behaves as before.
- **A number field may have a range** (`min`, `max` on the field). Outside it, submitting is refused with `out_of_range`.
- **A number field may take whole numbers only** (`integer` on the field, as the workshop's participants do). A fraction is refused with `not_integer`. A configuration whose whole-number field has no whole number between its two ends (15.1 to 15.9) is refused: nobody could answer it.
- **Where the call is silent, earlier defaults stand** until the organisers say otherwise: three anonymized reviews for the call's "academic" formats and two with names visible for its "artistic" ones; team sizes (a panel may have up to 24 people: six talks of up to four authors each, so that co-authors are never refused); panels not counting toward the cap of two; one bio limit of 300 words for the whole conference (the call asks for 250, and 200–300 for the exhibition: [issue #17](https://github.com/AMSUCF/ELOchair/issues/17)).
- **Panels** hold their papers' abstracts in one required field until submissions can carry them as separate items ([issue #15](https://github.com/AMSUCF/ELOchair/issues/15)).

### 1.9 Conference settings
Chairs adjust a conference's values in the app, at `/c/:slug/settings` (linked from "Manage submissions"). This is stage one: existing values, and the wording of the emails the app sends. Adding, removing or reordering formats, fields, review pools, criteria and agreements is still done by importing a configuration.

- **Who.** Configuration changes are human-only: agents are refused, whoever they act for.
  - **Chairs do everything.** The `chair` and `admin` roles and site admins are one group (`isConferenceChair`). In the app a chair may do whatever an admin may: save any valid configuration, and move the phase (§1.3). The `admin` role stays in the data and means nothing more than `chair`. Track chairs and reviewers may not open the screen.
  - **The screen offers the stage-one values**, the same to every chair. They are defined once, in `packages/schema/src/settings.ts`, which the screen renders from:
    - the conference: title, theme, what sets the edition apart and the invitation (both optional; §1.10), host, place, modality, contact email, website, dates, the "provisional" mark
    - the four deadlines, and between the second and the third the day reviews are due, which a conference may do without (spec 03, §1.8): emptying its date takes it away. Right after it, how many days before that day reviewers are reminded (spec 03, §1.7): optional, and three where it is empty
    - the presenter cap's number and the bio word limit (where the conference has those rules)
    - of each existing format: name, description, what the abstract is called, its fewest and most words, minutes on the program, fewest and most people
    - of each existing field: label, help text, whether it is required, for a text field its most words, and for a number field its range and "whole numbers only". A value that the field's kind does not have (a word limit on a number or a link) is not offered, although the schema accepts it there.
    - of each existing review pool: name, how authors appear to its reviewers, reviews per proposal, and the guidelines for its reviewers. Under the pool's name the screen says which formats the pool reviews, and which of them has a mode of its own that the pool's choice does not change.
      - How authors appear is chosen from three sentences that say what the reviewer projection gives: anonymized (no authors, and no answers marked as identifying); the authors' names and affiliations; their names, affiliations and bios. Only authors who have confirmed are ever shown.
    - of each existing criterion of a pool: label, an optional description, smallest and largest score. The smallest must be below the largest.
    - of each existing review pool's form (spec 03, §1.8): what is written under the comments for the authors, their fewest and most words (both optional; the fewest must not be above the most), whether the form has a note for the chairs only and what is written under it, and whether it asks for a recommendation and what is written under that. A description left empty is the app's standard sentence, which the screen quotes.
    - of each existing agreement: title, text, link and version ("Agreements", below)
    - of each email the app sends to the people on a proposal: its subject and its text, in English, Spanish and Portuguese ("Emails", below). These are offered whether or not the conference has written any, and whichever of the three languages are its own.
    - the names and descriptions of formats not submitted here, and the names of existing tracks and topics
    - of each existing way to contribute (§1.10): its name and its line. Under its name the screen says which formats it leads to.
  - **Everything else has no screen:** adding, removing, reordering or re-keying anything, review pools and criteria included; the year, time zone and languages; adding or removing an agreement, and its key; a field's kind, options, `identifying` and `public`; a format's review pool and its own blind mode; adding or removing a way to contribute, and which formats it holds. It is done by importing a configuration, and the screen says so. Through the API a chair's save of any of it is taken like any other, under the rules below: there is no longer a list of what a chair may not change, and no 403 with paths. The slug is never changed by a save (400 `slug_mismatch`).
- **Submitted work stays valid.** A save is checked, under the conference's row lock, against every proposal that has been sent in and not withdrawn or turned down, with the validation the submit path uses. If one of them would gain a problem it does not have now, nothing is saved: 409 `submitted_work_invalid`, with the count, the counts by problem, and the IDs of those the person may manage as a chair (their own and conflicted work is only counted). Every chair is held to it, whatever the change: a format that submitted proposals use cannot be removed.
  - **Drafts never block.** The review says how many drafts would gain a problem.
- **A save and a write wait for each other.** A save holds the conference's row for update while it checks. Every write to a submission, or to who is on it, shares that row before it reads or writes anything about the proposal. So a write is checked against the configuration in force when it commits, and a save never checks work that is changing under it.
  - **Which writes:** every owner action and a contributor leaving (all through `mutateSubmission`), an invitation answer by session or by emailed link (`answerInvitation`), and creating a proposal. A new route that writes `submissions` or `contributions` takes the row with `shareConference()` the same way; `settings-locks.test.ts` checks each route.
    - A reviewer's writes share it too (spec 03, §1.4): saving or sending a review, and saying they cannot review a proposal. A save checks the reviews already sent against the form it would leave ("Sent reviews stay valid", below), and never misses one that is being sent at that moment.
  - **One lock order everywhere.** A transaction takes what it needs of these, in this order, and never goes back for an earlier one:
    1. the row of what it changes, for update: a submission's, or a role invitation's (spec 03, §1.2);
    2. the conference's roles lock: shared by whoever acts as a chair, exclusive for a change to who holds a role;
    3. the conference's row: shared by a write, for update by a save or a phase move;
    4. the locks that count a day's invitations: the sender's, then the address's.
    - A write to a proposal takes the first and the third (and the fourth, to invite). Creating a proposal has no row yet and starts with the conference's. A save and a phase move take the second and the third. On the People page, inviting takes the second, third and fourth; sending again all four; cancelling the first two; removing a role the second alone (a reviewer's removal releases their assignments under it). Accepting an invitation to a role takes the first three, declining the first and the third. Assigning a reviewer to a proposal and releasing one (spec 03, §1.3) take the first three: the proposal's row, the roles lock shared, and the conference's row shared. A reviewer's own writes (a review saved or sent, and "I cannot review this"; spec 03, §1.4) take the same three in the same order, and under the roles lock they read the reviewer again, as a chair's change reads the chair.
    - Nothing holds the rows of two submissions, of two invitations or of two conferences. So nothing waits for a lock while it holds one that comes later, and the orders cannot cross.
    - The database takes one more lock by itself, in no order of ours: writing a row checks its foreign keys, with a key-share lock on each row it points to. Only a lock "for update" makes that wait. A reviewer's removal writes the record of each assignment it releases (spec 03, §1.3) under the roles lock, and each record points to a proposal. So assigning a reviewer and releasing one, and a reviewer's own writes, which hold a proposal's row and then ask for the roles lock, take that row "for no key update": still in order with the owner's writes and with each other, and passed by that check. Otherwise the two would wait for each other.
    - The order is written where the roles lock is taken (`apps/server/src/services/roles.ts`), and `settings-locks.test.ts` checks it request by request.
  - **A chair removed meanwhile changes nothing.** Once the removal of a chair's role has committed (spec 03, §1.2), nothing that person began as a chair commits afterwards.
    - A route checks who is asking before its transaction begins, and a chair may be removed between the two. So every change that is allowed because the caller chairs the conference reads the caller's role again inside its own transaction, under the roles lock (shared), and is refused with 403 if the role is gone: a save, a phase move, on the People page inviting, sending again, cancelling and removing, and on a proposal's page assigning a reviewer and releasing one.
    - A removal takes the roles lock exclusive. It therefore waits for the changes already under way, which commit as a chair's, and every change that comes after it is refused.
    - Reads are checked once, when they are asked for. A CSV export is a read: what it writes is the record that it was made.
    - A site admin holds no role at a conference. Their flag is read again in the same place, so the check works for them too. Nothing in the app takes that flag away (it is unset by hand, in the database), and doing so waits for no lock: a request already past the check can still commit.
  - **A profile save stays outside.** The only profile value the check reads is the display name. A profile save can give a name and cannot remove one, and whether a contributor needs a name does not depend on the configuration: such a save can end a problem and cannot cause one.
- **Guidelines for reviewers.** A pool may hold a text that the chairs want its reviewers to read before they review (`reviewPools[].guidelines`), in each language of the conference.
  - It is optional. When it is there it needs the conference's main language, like any other text.
  - A reviewer sees it under "Guidelines for reviewers", above every proposal assigned to them whose format that pool reviews: in their own language where it was written, otherwise in the main language, with its line breaks. A pool without guidelines shows nothing.
  - Like the rest of a configuration it is not confidential: anyone who can see the conference can read its configuration.
- **Emails.** Chairs change the wording of the emails the app sends to the people on a proposal. There are six, each defined once in `packages/schema/src/messages.ts`, which the server sends from and the screen renders from:

  | Key | Sent | Placeholders (required in the text in bold) |
  |---|---|---|
  | `invitation` | to someone an owner adds to a proposal, and when the owner sends it again | `{owner}` `{role}` `{format}` `{conference}` **`{link}`** |
  | `submission_received` | to everyone confirmed on a proposal when it is submitted | `{title}` `{format}` `{conference}` `{deadline}` **`{link}`** |
  | `submission_withdrawn` | to everyone confirmed on a proposal, and to `contactEmail`, when it is withdrawn | `{title}` `{format}` `{conference}` **`{link}`** |
  | `invitation_withdrawn` | to people still invited to a proposal that is withdrawn | `{conference}` |
  | `invitation_answered` | to the owner, when someone confirms, declines or leaves | **`{person}`** **`{answer}`** `{conference}` **`{link}`** |
  | `draft_deleted` | to people still invited to a draft that is deleted | `{conference}` |

  - **What is stored.** `messages` in the configuration: for any of the six keys, a `subject`, a `body` or both, each a text in any of `en`, `es` and `pt`. All of it is optional. Absent means the standard text, and that has one spelling: an object with nothing in it is refused, so a conference that has written nothing holds no `messages` at all, and its configuration and token are what they were before this existed.
  - **Which text a person gets,** for the subject and for the body separately: the conference's own text in that person's language where it has written one, otherwise the standard text in that person's language. Never another language's own text: a person must be able to read their mail. Whose language that is has not changed: an invitee's is the invitation's; anyone else's is the first language of their profile that the app writes mail in, else the conference's default.
  - **Placeholders.** A text names what is only known when the mail is sent as a word in braces. Anything in braces on one line counts as one, so `{ link }` and `{enlace}` are refused as unknown, not sent as they stand.
    - A text may name only its own message's placeholders. So an invitation, and the two notices to people still invited, cannot name the title or anything else an owner wrote (§1.2).
    - A text must name the placeholders its message is useless without: the link wherever a message has one (it is the only thing that says which proposal the mail is about, and for an invitee the only way to answer), and for the answer to the owner who it was and what they did.
    - A subject cannot hold the link. An invitation's link is a secret that is removed from the stored copy of the body once the mail is sent, and nobody can follow a link in a subject line. The server never puts it there, whatever a text says.
    - The subject of an invitation cannot hold the owner's name either. It is the one thing an owner wrote that reaches someone who has agreed to nothing, and it stays in the body, where it has always been. (The answer to the owner may name `{person}` in its subject: the owner typed that name, and is its only reader.)
    - **A name is a word of its own.** The placeholders that stand for a name a person typed are marked in the definitions (`names`): `{owner}`, the owner's display name, and `{person}`, what the owner typed for someone they invited. The server takes links out of an owner's name (§1.2), and a text must not put the rest of a link around it: `https://{owner}.example` would mail the name "attacker" as an address.
      - Before such a placeholder, between it and the space or the start of the text, only brackets and quotation marks that open may stand (and the Spanish ¿ and ¡). After it, up to the next space or the end: an English possessive (`'s`), then only brackets and quotation marks that close and the punctuation that ends a phrase (`, . ; : ! ? …`).
      - So `({owner})`, `{owner},`, `«{owner}»`, `{owner}: ` and `{owner}'s proposal` are taken. `https://{owner}.example`, `{owner}.com`, `www.{owner}.org`, `{owner}@example.org`, `mailto:{owner}`, `{owner}-site.org`, `{owner}:8080`, `{owner}/path` and `x{owner}` are refused (`message_name_touched`), in a subject as in a body, and so are the same with the other dots that mail clients take for a domain's. Everything from the name to the nearest space counts, not only the character beside it, because an address runs on to the space.
      - What a link or an address is has one definition, `packages/schema/src/links.ts`: the detectors that `sanitizeName` removes from a name. They are the tests' oracle: for every text that passes and every name the sanitizer lets through, no link, host name or address in the filled subject or body includes a character of the name.
      - When a name is put in, it is also set apart by a space wherever it and what stands next to it would still read as a link and the name alone does not. The rule lets a comma and a question mark touch a name, and the detectors take "Tel:," and "J.R?" for links. No standard text is changed by that: there a name has a space on either side.
      - `{person}` is shown to the owner as the owner typed it, an address included. The rule keeps a text from adding to it.
    - `{role}` and `{answer}` stand for words the app supplies in the language of the email ("co-author"; "confirmed", "declined", "left"). The screen lists them. They are not offered for change.
  - **What a text may be.** It says something that shows (an emptied text is refused, never taken as "the standard text"); a subject is one line and at most 200 characters; a body at most 5,000, with line breaks and tabs and no other control character; and it is in one of the languages the app writes mail in: English, Spanish or Portuguese.
    - In a body the link stands apart, with a space or a line break on either side. Whatever touches an address may be taken for part of it (`{link}.`), and then the link does not work.
    - **No invisible characters.** A subject or a body that holds a character nobody can see and writing does not need (a bidi override, a zero-width space, a byte-order mark, a soft hyphen, a tag character) is refused (`message_invisible`): such characters can hide or reorder words, in ELO's own mail as in a name. The definition is the one used for what owners write (`packages/schema/src/invisible.ts`), so the joiners inside Persian and Indic words and emoji are taken. The screen takes these characters out of what was typed or pasted before it is previewed, reviewed or saved, so that an innocent paste just works; the schema is what stops anyone going round the screen. Other texts of a configuration are not held to this.
    - **All three languages, at every conference.** Mail goes out in any of the three, whatever the conference's own languages are: an owner may invite someone in any of them, and everyone else is written to in the first of them their profile lists. So the wording of an email is offered and taken in all three, and here only: every other text of a configuration is offered in the conference's languages. At a conference in English and Spanish, the Portuguese emails can be reworded too.
      - No language is required, not even the conference's main one. Each language's subject and each language's body is, on its own, either the conference's text or the standard one.
      - A language the app does not write mail in is refused, even where the conference has it (`fr`, or a regional `pt-BR`, whose readers get the `pt` mail).
    - All of it is checked in the schema, so every way of saving is held to it. A text that fails is named in the review, by path (`messages.invitation.body.es`) and with a code (`message_unknown_placeholder`, `message_missing_placeholder`, `message_not_in_subject`, `message_link_touched`, `message_name_touched`, `message_invisible`, `message_not_one_line`, `message_too_long`, `message_empty`); a save of one is refused with 400 `invalid` and stores nothing.
    - **Read back, an email this version does not know is left out.** A stored configuration is read in one place (`toConference` in `repo.ts`, through `readStoredConfig` in `packages/schema`). There, and only there, wording stored under a message key that this version does not have is left out before the configuration is validated. A later version of the app adds emails; when the app is rolled back one version, the conference whose chairs reworded one of them, and the list of conferences with it, must still load.
      - Nothing else about reading is more lenient than saving: an unknown part or language of an email this version sends, a text it cannot send, and `messages` stored with nothing in it are refused on reading as before.
      - What comes in stays strict: the settings save, its review and `import-config` refuse an email they do not know.
      - **What was left out is not kept.** The screen never saw it, so a settings save that changes something stores the configuration as this version read it: the later version's wording of that email is gone, and that email is in its standard text when the later version returns. (A save that changes nothing writes nothing, and the wording stays.) It is what happens to every other value a later version added and this one does not know.
      - The rule holds from the version that added the emails of the review phase (spec 03, §1.7) on. The versions before it refuse such a configuration whole; spec 03, §2 says what to do before going back to one of those.
    - Chairs' text is used as it is written, as plain text. What goes into it is cleaned as before (§1.2).
    - Like the rest of a configuration, the wording is not confidential: anyone who can see the conference can read its configuration, and the audit log keeps every text that was saved. The screen says so, because an email is where someone might put an address or a link that is not for everyone.
  - **On the screen,** "Emails" comes after "Review", with one section for each email. It says when the email is sent and to whom, lists the placeholders with what each stands for and which the text must contain, and has, for each of the three languages (the conference's main language first, where it is one of them), the subject, the text, and the email as it would be sent, filled with made-up names and titles as it is typed. One sentence says why all three are there.
    - A box shows what is sent: the conference's own text, or the standard text while it has none. A text equal to the standard one is not stored. "Use the standard text" puts the standard text back in both boxes of that email and language, and saving that removes the conference's own. It asks first when it would lose text that was typed and not saved.
      - Through the API a text equal to the standard one is taken and stored like any other; it is sent like any other, and the screen shows it as the standard text.
    - The review lists each text by path, from or to "the standard text" where there is no own one, and the audit entry holds the same.
  - **The sign-in email is fixed.** It is the same for every conference and is not offered.
- **Agreements.** Chairs edit what people accept when they submit a proposal or confirm an invitation (§1.5): of each existing agreement, its title and its text in each language of the conference, its link, and its version. Agreements are added and removed by importing a configuration.
  - **A changed agreement needs a new version.** A save that changes an agreement's title, text or link in any language while its version stays the stored one is refused. Agreements are matched by key.
    - **In the review:** `POST …/config/preview` names the version as an issue, path `agreements.<key>.version`, code `agreement_version_required`, with `canSave` false. On the screen the reason is said beside the version, which is the value to change.
    - **In the save:** `PUT …/config` answers 409 `agreement_version_required` with the same issues, and saves nothing. (When a save would also show the authors of an anonymized review, the answer carries both kinds of issue under the code of the first.)
    - **What is allowed:** a new version alone, and any change that comes with one. The new version only has to differ from the stored one and be 1 to 40 characters; the screen suggests a date such as 2026-12, or a number.
  - **The screen says what a new version does** (§1.5), in each agreement's section and again in the review whenever a version changes: who accepts it from then on, that what was accepted stays recorded against the old version, that nobody is emailed, that submitted proposals are not affected, and that a page open at that moment has to be reloaded.
  - An agreement needs a text or a link; the text needs the conference's main language, like any other; the link is an https address. Each is said beside its value.
  - Like every other change, it is audited by path (`agreements.privacy.text.en`, `agreements.privacy.version`), with the values before and after.
- **An anonymized review that has begun stays anonymized.** Reviewers were promised, and authors were told, that the authors are not shown. Once a proposal has been given a reviewer (`assignments`), a save that would show a reviewer of it who wrote it is refused: the mode in force for its format (the format's own, else its pool's) may not go from anonymized to names shown.
  - **In the review:** `POST …/config/preview` names the value that would do it as an issue, code `reviewers_assigned`, with `canSave` false. On the screen that value is the pool's `reviewPools.<pool>.blindMode`, and the reason is said beside the choice. Through the API it may also be a format's own mode (`submissionTypes.<format>.blindMode`) or the pool that reviews it (`….reviewPool`).
  - **In the save:** `PUT …/config` answers 409 `reviewers_assigned` with the same issues, and saves nothing.
  - **What is allowed:** every change while no proposal has had a reviewer, and hiding names that were shown. A format with a mode of its own is not touched by its pool's. The rule protects anonymity and nothing more: where names are shown already, bios may still be added.
  - **It is one way.** A pool that is made anonymized while its proposals have reviewers cannot be changed back, and removing the reviewers does not undo it. The screen says so under the choice.
  - Any assignment counts, whatever became of the proposal since, and whatever became of the assignment. One that was released (spec 03, §1.3) is no longer in `assignments` and counts for nothing anywhere else; its record is kept in `assignment_releases`, and it still counts here: the reviewer may have read the proposal anonymized, and can be assigned to it again. If a release took a proposal out of the guard, a chair could release its reviewers, show names and assign the same people again.
  - The routes that assign and release reviewers (spec 03, §1.3) read the chair again under the roles lock, as every chair's change does, and then take the conference's row with `shareConference()`, as a write to a submission does, so that a save never checks assignments that are changing under it.
- **Sent reviews stay valid**, as submitted proposals do (spec 03, §1.4 and §1.8). A review that was sent holds a score for each criterion, comments, and where the form has them a note and a recommendation. A save that would leave one of them outside the form is refused, at the value that would do it, with how many reviews it would do it to:

  | The change | Refused when a sent review | Path | Code |
  |---|---|---|---|
  | a criterion's smallest score raised | gives a lower score | `reviewPools.<pool>.criteria.<key>.min` | `reviews_below_scale` |
  | a criterion's largest score lowered | gives a higher score | `….criteria.<key>.max` | `reviews_above_scale` |
  | a criterion removed (by import) | has a score for it | `reviewPools.<pool>.criteria` | `reviews_have_scores` |
  | fewest words of the comments set or raised | has fewer | `….form.comments.minWords` | `reviews_too_short` |
  | most words set or lowered | has more | `….form.comments.maxWords` | `reviews_too_long` |
  | the note for the chairs taken off the form | has a note | `….form.chairNote.enabled` | `reviews_have_note` |
  | the recommendation taken off the form | gives one | `….form.recommendation.enabled` | `reviews_have_recommendation` |
  | a format given to another pool (by import) | exists for one of its proposals | `submissionTypes.<format>.reviewPool` | `reviews_sent` |

  - **In the review:** `POST …/config/preview` names each such value as an issue with `params.n`, the number of reviews, and `canSave` false. On the screen the reason is said beside the value.
  - **In the save:** `PUT …/config` answers 409 with the same issues, under the code of the first, and saves nothing. The reviews are read under the conference's row, which every write of a review shares.
  - **What is always allowed:** a new label or description, a wider scale, a looser limit, putting the note or the recommendation on the form, and every change while no review of the pool was sent. A review sent before the recommendation was put on the form simply has none; it is asked for when its reviewer next changes it.
  - **Drafts never block.** A draft is its reviewer's own and is not read for this at all. One that no longer fits the form is shown to its reviewer as far as it fits, and is checked like any other when it is sent.
  - Every review that was sent counts, whatever became of its proposal since.
  - **A review that is kept from the chair asking is not read for this either.** A chair is never shown a review of their own proposal (one they are on, invited or confirmed), or of one they have a conflict with, nor that one was sent (spec 03, §1.5; `reviewsKeptFrom` in `packages/policy`). If the refusal depended on such a review, it would say that there is one, and what it holds: a chair could try one end of a scale after another and read their own scores from what is refused. So nothing is asked of those reviews: not what they hold, and not whether there are any.
    - What is decided for that chair is decided without those reviews, from two things only: the proposal was submitted at some time, and **the conference has been in review**. From then on, and for good, every change in the table is refused to them for the pool that reviews it: `reviews_hidden`, at the same path, without a number, whether or not a review of it exists, whatever one holds, whatever became of the proposal since (withdrawn, back in a draft), and whichever phase the conference is in.
    - **That the conference has been in review is recorded on its row** (`conferences.review_began_at`), because the phase it is in now does not say so: a chair can force a conference back out of review, and the reviews stay. The mark is set the first time the conference is found in a phase in which reviewers can read (`reviewing` or a later one) and is never cleared. Everything that gives a conference a phase sets it: a move of the phase through the API or the CLI (into such a phase, and also out of one where the mark is still empty), a conference created or imported in such a phase, and the start of the server, which marks every conference it finds in such a phase without it. The refusal applies when the mark is set, or the conference is in such a phase now (`reviewHasBegun`). It is a fact every chair knows.
    - A chair who has no proposal of their own before that pool, and no conflict with one, can make the change, and the refusal says so. Where there is no such chair (a conference with one chair who submitted to it, or two who both did), one has to be invited first: the refusal says that too. Until the conference has been in review this refusal is made to nobody; and it is never made for work that was never submitted.
    - Every other review that was sent is weighed by what it holds, for any chair and in any phase, with its number: also the review of a proposal that went back to a draft since, which no chair is shown any more. A review counts once at each value it would be outside of, however many of its scores a change removes.
    - **What the refusal tells a chair.** That at least one proposal kept from them was submitted at some time for a format the pool reviews; and, where the change gives a format to another pool (which no screen offers: the API can ask for it), that it was of that format. Never how many, and never which proposal. Of their own proposals they know that. Of the proposals they have a conflict with, they can already work out this much:
      - The overview on "Manage submissions" counts every proposal that was submitted and is not a draft now, format by format, kept ones included, and the list under it holds only those they are shown. The difference is, for each format, how many proposals they have a conflict with, whatever became of them: live, withdrawn or turned down.
      - The same page says their total as one number for the whole conference, whatever the filters ("{n} you cannot manage"), and the Assignments page how many of them are still under consideration ("{n} proposals are not listed").
      - The review of a settings change counts every live proposal the change would make invalid and names only those the chair manages (`blocked`, above); and it counts the drafts the change would affect, anyone's, as one number.
      - So `reviews_hidden` adds one thing: that a proposal they have a conflict with which was submitted, and has since been taken back to a draft by its owner, exists, for a format of that pool. (The pages above count it among the drafts, and say nothing more of it.) Whether a chair should learn that is the project owner's decision; the guard is not made weaker to avoid it, and the reviews are never read to decide it. The organizers accepted on 2026-11-22 what this refusal lets a chair with a conflict infer: a conference's chairs are trusted and are assumed not to game the system, and no further guard is to be built around it.
    - **What can still leave a sent review outside its form:** nothing a chair or anyone else does through this version of the app, while it is the only thing that moves the conference's phase. (If something else moved a conference into review and out again while this version was taking reviews, an earlier version of the app serving beside it, or SQL by hand, the row would have reviews and no mark.) An earlier version of the app run on the same database (a roll-back) can: it knows nothing of reviews, and its settings screen changes a scale. The CLI's `import-config` applies none of the guards of this section, as it never has (and neither does `seed --force`, which is refused in production).
- **Review before saving.** `POST …/config/preview` saves nothing and answers with the changed values (before and after), problems by value (what the schema refuses, a mode that may no longer show names, and a value that would leave a sent review outside its form), what blocks, and what warns: drafts affected, a call that this would open or close at that moment (closing stops starting, editing and submitting proposals and confirming invitations; withdrawing follows the phase, §1.3, and declining is always possible), a deadline moved into the past. The screen always shows this before "Save changes", and offers no save while something blocks.
- **The form stays open while a save is on its way.** What was reviewed is what is saved. Whatever is typed in the meantime stays in the form as an unsaved change to the saved configuration, the page says so without taking focus from the person typing, and it is reviewed in its turn before it can be saved.
- **Two people at once.** A save names the configuration it started from (`If-Match`, a token of the stored configuration, given by `GET …/settings`). When that is no longer the stored one the save is refused with 409 `stale`, and the screen offers to reload; what was typed stays in the form.
- **Deadlines keep their offset.** A deadline is shown and edited as its date, its time and its UTC offset, each as stored. The offset changes only when someone writes another one. (The day reviews are due has none stored until it is set: its time and offset start at 23:59 on the offset the day decisions are sent is written in, shown in the boxes, so that typing a date is enough and what is saved is what is shown.) As it is typed, the screen says which instant it is in the conference's time zone and in the reader's. The pages people read show a deadline as it was written (§1.10).
- **Texts** are edited in each language of the conference; the default language is required. (An email's wording is the exception on both counts: it is offered in the three languages mail goes out in, and each stands alone, falling back to the standard text.) The screen offers a text in those languages only: there a chair may change it, clear it, or write one that was missing. A text in any other language would add a language to the conference, which has no screen, like the list of languages itself.
- **Audit.** One `conference.config_updated` entry per save, with every changed value's path, before and after, and how many drafts were affected. A configuration holds no personal data.
- **Unsaved changes survive a reload.** What a chair has typed and not saved is kept in that browser, under their own id, like unsaved text in the proposal editor: it is back after a reload or a closed tab, with a notice and a way to discard it, and it goes on save, on discard and on sign-out. It follows the form: what was typed while a save was on its way is still unsaved, so that part stays kept, and only that part. It is kept as typed, by setting, not as a configuration: it goes back on top of whatever is stored now, exactly as after "Reload the settings", an edit to something that is no longer a setting is dropped, and the review before saving shows every change against the stored value.
- **Not yet:**
  - a screen for adding or removing formats, fields, languages, review pools, criteria and agreements. That is done by importing a configuration, by someone with access to the server.
  - the CLI's `import-config` applies neither the submitted-work check, nor the one for anonymized review, nor the one for an agreement's version, nor the one for sent reviews.

### 1.10 The invitation, and deadlines as the call states them
The front page and a conference's own page are where people arrive. What they show of a conference comes from its configuration and from what the server says about its call, never from its slug. Only the identity (colours, fonts, contour art) goes by `dressedAs(slug)`.

- **A conference may invite.** Three optional parts of a configuration make up its invitation. Stored configurations without them stay valid and need no migration.
  - `distinction`: one line per language that says what sets the edition apart.
  - `invitation`: a short paragraph per language that says what work the call welcomes.
  - `contributionGroups`: the ways to contribute. Each has a `key`, a `name` and a `summary` per language, and `formats`: keys of formats the call offers, submitted here or not. Every key must exist, a format is in one group at most, and a group has at least one.
  - Like every text of a configuration they need the conference's main language, and they are public.
- **Which pages.** A conference whose configuration holds any of the three *invites* (`invites()` in `apps/web/src/invitation.ts`).
  - The **front page** features one conference: the one whose call is open, else the one furthest from the archive, else the most recent. If that conference invites, the front page is its invitation, and the other conferences follow as compact cards. It then wears that conference's identity, if it has one.
  - The **conference page** of a conference that invites begins with the same invitation and goes on with its formats and its deadlines.
  - A conference that does not invite is shown as before on both: a card under the heading "Conferences" on the front page, and its own page with its title as the heading.
- **What an invitation shows**, in this order:
  1. the conference's title and where its call stands
  2. the theme, as the page's heading
  3. the main action
  4. the dates, the place, the host and the `distinction`
  5. the `invitation`
  6. a link to the full call (`website`)
  7. when proposals are due
  8. "Ways to contribute": the languages proposals may be in, then each group with a link to its first format on the conference page
  9. "Already involved?": a link to the person's own proposals and two to the sign-in page, for reviewers and for organizers. Everyone signs in the same way; what a person may do follows from their roles.
  10. the conference's website again, in the footer
  - The conference page adds what it always showed: the coordinates, the days left while the call is open, and "Manage submissions" for the conference's chairs.
- **Two languages.** Each text is followed by its echo in the conference's other language, as on the rest of the public pages. The echo is hidden from assistive technology.
- **Where the call stands** is one of three states, decided by the server's clock (`callState` in `packages/schema/src/call.ts`) and sent with the list of conferences and with each conference:

  | State | When | The invitation says | Main action |
  |---|---|---|---|
  | `open` | `isCallOpen` (§1.3) | "Call for proposals" | "Start a proposal", to the Start page |
  | `upcoming` | phase `cfp_open` before `submissionsOpen`, or phase `draft` before `submissionsClose` | "Call opening soon", and the day submissions open | "Prepare a proposal", to the formats on the conference page |
  | `closed` | `submissionsClose` has passed, or the conference is in a later phase | "Submissions closed", and "The submission window has closed." in place of the due date | "View my proposals", to "My submissions" |

  - `callState` is for display. What people may do is still decided by `isCallOpen` and the policy.
  - **The chip** on the front page says the phase's name, with one exception: "Call for proposals open" is said only while the call is open. In phase `cfp_open` before the opening date it says "Call opening soon", and after the closing date "Submissions closed".
- **A deadline is shown as its call states it.** A deadline is stored with the offset it was written with (§1.9). The pages show the date and the time as written, and say which clock that is (`statedDeadline` in `packages/schema/src/deadline.ts`):

  | Written offset | Clock | Shown as (English) |
  |---|---|---|
  | the offset the conference's time zone has at that instant, daylight saving included | the conference's | "Feb 28, 2026, 11:59 PM (America/New_York)", as before |
  | −12:00 | anywhere on Earth | "Feb 14, 2027, 11:59 PM, anywhere on Earth (AoE)"; "… AoE" on the invitation |
  | any other | that offset | "Apr 30, 2027, 11:59 PM (UTC−08:00)"; "(UTC)" for none |

  - The conference's own clock is asked first, so a conference whose deadlines are written in its own offset reads exactly as it did.
  - **Where:** the invitation, the conference page (its hero, the sentence about when the call runs, and the timeline), the editor's deadline line and "My submissions".
  - **The visitor's own time** stays beside it where it was: in the timeline whenever it reads differently, and in the editor.
  - **Not yet in mail.** The receipt email still gives the closing date in the conference's time zone ([issue #16](https://github.com/AMSUCF/ELOchair/issues/16)). So does the settings screen, which shows the instant in the conference's time zone and in the reader's as it is typed.

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
| `PATCH /api/submissions/:id` | owner, open call | `{version, …content}`; type change only while a draft, and never once the proposal has had a reviewer (spec 03, §1.3) (answers the new type does not define are dropped); custom-field keys the type does not define get 422 `unknown_field`; 422 if it would invalidate submitted work |
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
| `GET /api/conferences/:slug` | anyone who can see the conference | configuration, phase, `callOpen` and `callState` (server clock; §1.10) |
| `GET /api/conferences/:slug/settings` | chair or admin (human) | configuration and its token; §1.9 |
| `POST /api/conferences/:slug/config/preview` | chair or admin (human) | the configuration as it would be saved; saves nothing; §1.9 |
| `PUT /api/conferences/:slug/config` | chair or admin (human) | whole configuration, `If-Match` required (428 without); 409 `stale`, `reviewers_assigned`, `agreement_version_required` or `submitted_work_invalid`; row-locked, audited; §1.9 |
| `PUT /api/conferences/:slug/phase` | chair or admin (human) | `{phase, from?, force?, reason?}`; forward only unless `force` + `reason` (409 `phase_backwards`); with `from`, only from that phase (409 `stale`); row-locked, audited; moved from "Manage submissions", §1.3 |
| `GET /api/conferences/:slug/submissions` | per policy | `SubmissionQuery` |
| `GET /api/conferences/:slug/submissions.csv` and `contributors.csv` | chair (human), or tier C on internal | §2.3 |

Write routes have a 64 KB body limit (256 KB for a whole configuration) and 60 writes a minute per person. Input schemas cap characters: title 300, abstract 8 × maxWords, each field 10,000.

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
- **`seedOpenCall(db, { slug, now })`** clones ELO 2027 with deadlines relative to the clock, each written in the offset the configuration writes it in (so the closing date is stated anywhere on Earth, §1.10), and the phase set to `cfp_open`. Development and the e2e tests use it, so they exercise what people will really be offered, on any date.
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
- **Bio lengths by format** ([issue #17](https://github.com/AMSUCF/ELOchair/issues/17)).
- **The closing date stated as "anywhere on Earth" in the receipt email.** The pages state it so (§1.10); the email still gives it in the conference's time zone ([issue #16](https://github.com/AMSUCF/ELOchair/issues/16)).

**Not needed for the January launch**
- **Transferring ownership.** Chairs can reassign it in the database, with an audit row.
- **A chair removing a pending invitee.** The invitation conflict and `withoutAvailableChair` expose the abuse case in the meantime.
- **Purging people created by unanswered invitations.** This belongs with the data-retention work.
- **Presentation and work languages.** Use custom fields if the CFP needs them.
- **Several affiliations per person.**
- **Email change.**
- **ORCID sign-in.**
- **File uploads.**
