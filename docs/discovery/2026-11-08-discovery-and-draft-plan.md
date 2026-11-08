# ELOchair: discovery notes and draft plan

**Date:** 2026-11-08
**Status:** Draft plan. Section 0 lists the decisions made so far.

ELOchair is meant to be a submission and peer-review system, in the spirit of EasyChair, built around how the Electronic Literature Organization actually runs its annual conference and media arts festival.

## 0. Decisions so far (2026-11-08)

| Topic | Decision |
|---|---|
| First real use | **ELO 2027, Universidad del Norte, Barranquilla.** The 2027 team has agreed, and the portal opens around December 2026 to January 2027. |
| Build vs. adapt | **Custom build**, mobile-first and well designed for agentic tools |
| Scope | **Conference program** (talks, panels, workshops, experimental) **and exhibition and performances.** ELC volumes and prizes are out of scope for now; the data model should not rule them out later. |
| Computational assistance | **Chairs only, local models.** It never writes reviews or makes decisions, and is disclosed publicly. |
| "Agentic" means | **Chairs run the conference through agents** (role-scoped API plus MCP, approval steps, audit log), and the **codebase is built to be maintained with coding agents** |
| Data rule | **Content stays local.** Cloud agents see metadata and aggregates only; anything that touches abstracts, bios, names or reviews runs on local models. See section 6.2. |
| Hosting | **ELO's own servers** (the infrastructure WSU Vancouver's Electronic Literature Lab runs for ELO), deployed with Docker |
| Not chosen (for now) | Conference configuration as versioned files in git: configuration lives in the app and is editable through the UI and the chair API. Agent use by submitters and reviewers. |

---

## 1. Sources reviewed

| Source | What it gave us |
|---|---|
| `AMSUCF/ELO2026` | 2026 CFP (`cfp.md`, `cfp.html`), the STARS schedule scraper and its `data/events.json` (108 scheduled events), the proceedings page, the town-hall slide plan (stats, reviewer list, ELO 2027 announcement), and the portal design spec |
| `eliterature/archives` | Archived conference sites for 2021, 2022, 2024 and 2025: CFPs, committees, logistics, acceptance notices. The 2023 (Coimbra) capture is a 404 page, so 2023 is a gap. Also the ELO 2026 exhibition source and its ELMS `works.json`. |
| `eliterature/elc5-info` | ELC5 call (in 15 languages), submitted through a Google Form, and the editorial collective's review-process updates |
| Live STARS pages (`stars.library.ucf.edu/elo2026/…`) | **Not reachable from this environment** (the host does not resolve). The 2026 review workflow inside Digital Commons therefore comes only from the repo and what is known of how bepress works. Those parts need your confirmation. |

## 2. What ELO actually does each year

### 2.1 Platforms have changed almost every year

| Year | Host / format | Submission and review platform |
|---|---|---|
| 2021 | Bergen + Aarhus, virtual | EasyChair. Full papers were attached to the original EasyChair submission. |
| 2022 | Como, hybrid, plus a "distributed conference" of partner nodes (Finland, Japan, Arab Academic Inst., Brazil, Mexico) | EasyChair for the main CFP. A separate Google Form for the Mentoring Exhibition, cross-referenced against EasyChair by hand. Partner nodes ran their own CFPs. More than 300 proposals, double-blind review. |
| 2023 | Coimbra, hybrid | Unknown (archive gap) |
| 2024 | UCF, fully online, "(un)linked" | STARS (bepress Digital Commons) |
| 2025 | York + Waterloo, in person, "Love Letters…" | EasyChair (`conf=elo2025`). Bios were sent "in a separate document" to keep abstracts blind. Curatorial pitches came by email. |
| 2026 | UCF, fully online, "(un)supervised" | STARS (bepress Digital Commons) |
| 2027 | Universidad del Norte, Barranquilla (Reyes / Rodríguez / Vera / Vásquez) | **Undecided.** This is the first conference after the "ELOrlando trilogy", so UCF's STARS will not be the default. |
| ELC5 (2026) | Editorial collective | Google Form. More than 370 submissions in many languages. Review ran in a manual "Round 0" (deduplication, access checks, translator matching), then "Round 1" (consultants given lists of 8–14 works grouped by language or specialty). |

**Takeaway:** every host rebuilds the pipeline from scratch, and the data ends up scattered across EasyChair exports, Google Sheets and bepress. Nothing carries over from year to year: not the reviewer pool, not the people's records, not the format rules.

### 2.2 Submission types vary but rhyme

| Type | 2024 / 2026 (UCF) | 2025 (Toronto) | 2022 (Como) |
|---|---|---|---|
| Individual talk / paper | 250–300 words, 10–12 min | 300 words, 15 min, plus 200–300-word bio | 500 words, 15 min, then a full paper of up to 3,500 words |
| Lightning talk | n/a | 150 words, 5 min | 50–100 words, 5–7 min |
| Panel / roundtable | 3–6 people, 350–500-word session abstract, 60 or 75 min | 3–4 papers or 5–6 lightning talks, 150 words each | 250-word overview plus 250 words per paper, 3–4 papers, 90 min. Lightning panels: 4–6 people. |
| Artist talk | n/a | 300 words, 15 min | n/a |
| Workshop | 250–300 words plus needs and timeslot | 1 hour, plus participant count (15–30) and A/V needs, held at a different site | n/a |
| Performance / reading | 350–500-word artist statement, 10–15 min, must work on Zoom | 300 words, tech requirements, link encouraged | n/a |
| Exhibition work | 350–500-word statement, URL, web standards, AI disclosure | 300 words, link encouraged | Poster, 250 words, A2 |
| Experimental track | 350–500 words; in 2024 it was a modifier on other types | n/a | n/a |
| Curatorial pitch | n/a | by email, outside the portal | n/a |
| Special call (e.g. Mentoring Exhibition) | n/a | n/a | Separate form with its own fields (audience age, collaboration context, language, platform, demo video) |

**Takeaway:** submission types must be **configuration, not code**. Each type needs its own word limits, duration, required fields, team size, and review pool.

### 2.3 Rules that recur every year

- **Anonymized abstracts.** Every UCF-era type says "anonymized for peer review". In 2025 bios went in a separate document. Under both platforms, blinding depended on submitters following instructions.
- **Presenter cap.** In 2024: "two presenting or first-author roles on the program (exclusive of panels)". In 2025: "not … more than twice as lead authors/artists/speakers, but may participate … more than twice". On those platforms this could only be checked by hand.
- **ELO membership is required to participate but not to submit.** Membership is paid separately at eliterature.org.
- **AI disclosure** for exhibition works in 2026. ELMS already has an `artificialIntelligenceInformation` block.
- **Open-access outputs.** Recordings, captions (VTT), proceedings (the 2026 PDF ran to 268 pages), optional full papers, and an exhibition with ELMS records.
- **Code of conduct** acknowledgment, and a recordings policy.

### 2.4 Review structure

- **Separate pools for scholarship and art.**
  - 2021 had three committees: program review (about 30), exhibitions (about 25), and performances (4).
  - 2022 and 2024 had a Scientific Committee and an Artistic Committee.
  - The 2026 town hall credits a combined "Artistic & Scientific Committee" of 41 people.
- **Organizers and track chairs also review**, and are often submitters too. The field is small, so conflicts of interest are routine rather than rare.
- **Exhibitions are juried or curated**: track chairs plus the exhibition team, and in 2025 named curators.
- **Language is a real constraint.** ELC5 grouped review lists by language. ELO 2027 is in Colombia, and ELO 2022 had Arabic-, Japanese- and Portuguese-language partners.
- **Format shifting happens** (a panel accepted as individual talks, a talk accepted as a lightning talk). Neither EasyChair nor STARS models this as a decision.
- **Grouping accepted talks into themed 3–4-paper sessions** is a big manual job for the chairs. So is assigning them across three parallel Zoom tracks (2024 and 2026: Algorithms & Imaginaries, Hypertexts & Fictions, Narratives & Worlds).

### 2.5 After acceptance: the archival flow is where ELO is unusual

```
accepted submission
 ├─ final abstract + bio + consent + licence ─► STARS event page (bepress)  ─► scraped into events.json (ELO2026 repo)
 ├─ optional proceedings paper ──────────────► proceedings PDF + STARS paper attachments
 ├─ recording + captions ────────────────────► STARS video + captions/*.vtt
 ├─ exhibition work + ELMS metadata ─────────► exhibition React app (works.json) ─► eliterature/archives
 └─ whole conference ─────────────────────────► ArchiveBox capture in eliterature/archives
```

In 2026 this required scraping, because bepress sends no CORS headers. It also required working around bepress quirks: the RSS feed labels times "PDT" when they are actually Eastern wall-clock times. A system ELO owns could **export each of these artifacts directly** from one canonical record, and EasyChair cannot do that.

## 3. Where EasyChair and STARS fall short for ELO (hypotheses to check)

| | EasyChair | STARS / bepress | Google Forms |
|---|---|---|---|
| Different forms per type (art vs. papers) | weak | configured by bepress staff | yes, but one form per call |
| Blind by construction (bios stored apart from content) | partial | depends on submitter | no |
| Separate artistic and scientific pools, track-scoped | partial | manual | n/a |
| Presenter cap, membership check | no | no | no |
| "Accept in a different format" | no | no | n/a |
| Multilingual interface and content; reviewer language matching | interface only | no | manual |
| Data carried across years (reviewer pool, people) | no | no | no |
| Exports to schedule, proceedings, ELMS, archive | CSV | scrape | CSV |
| Available to a non-UCF host | yes | **no** | yes |

**This table is my inference.** Section 6 asks what actually hurt in 2024–2026.

## 4. Draft design principles

1. **Each year's conference is data, not code.** A new host creates a conference, copies last year's types, review forms and email templates, and edits them. Handing off to the next host should be an export/import.
2. **Blind by construction.** Identity (names, bios, affiliations) lives on person records and is never rendered to reviewers in blind modes. The submission form flags self-identifying text, such as an author's name or a URL whose domain matches their affiliation.
3. **Review mode is set per type.** Double-blind for scholarship. Single-blind or open jury for exhibition and performance, where a work's URL reveals its maker anyway.
4. **Multilingual first.** The interface ships in English, Spanish and Portuguese at minimum. Submissions carry a language field. Reviewers declare languages, and assignment respects them.
5. **Archive-out.** Every accepted record exports to `events.json` (the format the ELO2026 schedule tool already reads), ELMS `works.json`, the bepress batch-upload spreadsheet, a proceedings source (Markdown/Pandoc), and an archive bundle for `eliterature/archives`.
6. **ELO-owned, cheap, low-ops, accessible.** WCAG 2.1 AA, a privacy posture that works under GDPR and Colombia's Ley 1581, and data export at any time.
7. **Human judgment at the centre.** Computational assistance is for chairs only, runs on local models, and makes suggestions only (reviewer matching, session clustering). It never writes reviews or makes decisions, and it is disclosed in the CFP and privacy notice.
8. **Mobile-first and agent-operable.** Every flow works one-handed on a phone. Every chair operation is also an API and MCP call with a preview step, and irreversible ones need a human to approve them in the UI.

## 5. Draft lifecycle and feature map

| Phase | Who | Core features |
|---|---|---|
| 0. Configure | ELO coordinator, chairs | Conference profile; submission types with word limits, durations, team size and extra fields; tracks and topics; review forms per pool; deadlines with time zones; email templates; languages |
| 1. CFP | public | Public CFP page generated from the configuration, in multiple languages |
| 2. Submit | submitters | Account by magic link or ORCID; co-author invites; per-type forms; live word counts; self-identification warnings; presenter-cap warning; edit until the deadline |
| 3. Triage ("Round 0") | chairs | Desk checks: duplicates, broken links, scope, language. Route to a pool and track. |
| 4. Assign | chairs | Reviewer profiles (expertise, languages, pool); bidding or expertise matching; conflicts of interest (self, co-author, same institution, declared); load balancing |
| 5. Review | reviewers | Per-pool forms (scores and criteria, comments to authors, confidential comments to chairs, recommended format); reminders |
| 6. Discuss | chairs, reviewers | Disagreement flags; discussion thread per submission; meta-review by track chair |
| 7. Decide | chairs | Accept / accept in alternate format / waitlist / reject; presenter-cap and balance dashboards (track, type, region, language, career stage if collected) |
| 8. Notify | system | Templated bulk mail with review excerpts; letters for visas and institutional funding |
| 9. Confirm | presenters | Accept or decline; membership confirmed; final abstract and bio; licence; recording consent; accessibility info; AI disclosure; tech and A/V needs; availability windows (time zones) |
| 10. Schedule | chairs | Group talks into sessions (with optional similarity suggestions); rooms or tracks; moderators; time-zone-aware preview; conflict checks (presenter double-booked, availability) |
| 11. Publish and archive | proceedings and web chairs | Exports to the schedule site, proceedings, ELMS exhibition, bepress or another repository, `eliterature/archives` |

## 6. Architecture (custom build — decided)

### 6.1 Shape

A TypeScript monorepo with **one shared schema layer**. That layer drives the database, the API, the MCP tools, form validation and the exporters, so an agent, or the next maintainer, changes a field in exactly one place.

```
packages/schema     Zod schemas = single source of truth (DB types, OpenAPI, MCP tool schemas, form rules, exports)
packages/policy     authorization + "projections": the ONLY code that turns a record into what a given role may see
apps/server         Node (Hono) API · Postgres (Drizzle) · magic-link auth · outbox email · audit log · MCP endpoint
apps/web            mobile-first PWA (React + Vite, matching the ELO exhibition app's stack) · i18n es/en/pt
apps/local-ai       CPU-only multilingual embedding worker (transformers.js/ONNX) on ELO's server — no third-party AI calls
packages/exports    events.json · ELMS works.json · proceedings source · bepress batch sheet · archive bundle · EasyChair/STARS importers
deploy/             Docker Compose (server, web, postgres, worker, Caddy TLS) for ELO's servers; backups; staging + prod
```

**Why this shape:**
- **Mobile-first.** Reviewers score on phones and submitters apply on phones, which matters for an event hosted in Colombia. The PWA autosaves review drafts on flaky connections.
- **Agent-maintainable.** The schema is typed end to end, and an `AGENTS.md`/`CLAUDE.md` sets the conventions.
  - A blindness test suite asserts that no identity field can leak through any reviewer-scoped API or MCP response.
  - Fixtures are modelled on ELO 2026's 108 events and types.
  - Playwright runs at phone widths.
- **Shared stack.** React/TypeScript matches what Dan Cox and John Murray already use for the exhibition app.
- **Matches the hosting decision.** Docker on ELO's servers.

### 6.2 Agent interface for chairs, with data tiers ("content stays local")

The MCP server and API expose **tiers**, and every agent action lands in an append-only audit log.

| Tier | What it contains | Who / what may access |
|---|---|---|
| **M: metadata** (cloud-safe) | opaque IDs, type, track, language, status, word counts, dates, reviewer load, score aggregates, conflict and cap flags, session slots | Chairs' agents, including cloud agents such as Claude, through the remote MCP endpoint |
| **C: content** (local-only) | names, emails, affiliations, titles*, abstracts, bios, review text, confidential comments | The web UI for humans; the on-server `local-ai` worker; tokens explicitly issued for a locally run model. **Never** the remote MCP endpoint. |
| **P: published** | Accepted items whose authors have confirmed and that are released to the public program | Everyone, including cloud agents. Items move C → P only when they are published. |

\*Draft default: titles count as content until publication. Open question 8.2 asks whether you want this.

**How content-heavy tasks work without leaving the server:**
- *Reviewer matching and session clustering:* the cloud agent calls `suggest_assignments` or `suggest_sessions`. The on-server embedding model reads the content and returns **IDs and scores only**. The chair checks the names and titles in the UI.
- *Emails:* the agent picks a template and a recipient set by ID. The server merges in personal fields at send time. The chair previews and approves the send in the UI.

**Rules for irreversible actions:** sending mail, recording decisions and publishing are two-step (*plan → human approve*). They are idempotent, and they cannot be approved from an agent token.

**Honest limit:** the server cannot verify that a "local model" token is really used by a local model. That part of the rule is a policy plus a per-token audit trail. What *is* enforced technically is that the remote, cloud-reachable endpoint never serves tier C.

### 6.3 Infrastructure facts needed from ELO's server

- OS, Docker availability, CPU and RAM. The embedding worker needs roughly 2 GB RAM.
- Backups.
- A subdomain, for example `chair.eliterature.org`.
- An SMTP relay or transactional mail service with DKIM on `eliterature.org`.
- Who to contact for all of the above.

## 7. Draft data model (core)

```
Conference(year, title, theme, host, modality, timezone, languages[], dates, deadlines, rules{presenter_cap, cap_scope})
SubmissionType(conference, key, labels{lang}, word_min/max, duration, team_min/max, review_pool, blind_mode, fields[])
Track(conference, name, chairs[]) · Topic(conference, label{lang})
Person(name, emails[], orcid, affiliations[], country, languages[], bio{lang}, pronouns, membership{status, through})
Submission(conference, type, track?, topics[], title, abstract, language, links[], tech_needs, accessibility, ai_disclosure, modality, status)
Contribution(submission, person, role: lead|presenter|coauthor|panelist|chair, order)   ← presenter cap counts these
ReviewerProfile(person, conference, pools[], expertise[], languages[], max_load)
Conflict(reviewer, submission|person, kind, declared_by)
Assignment(reviewer, submission, due) · Review(assignment, scores{}, to_authors, to_chairs, recommendation, alt_type?)
Decision(submission, outcome, final_type, notes) · Notification(template, recipients, sent_at)
FinalMaterials(submission, final_abstract, licence, recording_consent, proceedings_paper?, elms{})
Session(conference, track/room, start, end, kind, items[], moderator) · Exports(kind, generated_at, artifact)
```

## 8. Open questions (round 3)

Each item carries a **proposed default**. Only items you disagree with need an answer, except 8.1, which only you can answer.

**8.1 Pain points (no default possible).** What actually went wrong or felt heavy with STARS in 2024 and 2026 and with EasyChair in 2025? For example: assignment, anonymization slips, emails, presenter cap, membership chasing, final materials, scheduling, proceedings. These set the priority order after the MVP.

**8.2 Where the data tiers draw the line.** Default: names and titles count as content (local-only) until publication. Cloud agents work with IDs only.

**8.3 ELO 2027 specifics.** I need these from the Barranquilla team:
- the CFP draft, submission types and limits, and topics
- the portal open date and deadline
- conference dates and modality (in person, hybrid or online)
- interface and submission languages (default: es + en, with pt next)
- who the chairs, track chairs and exhibition chairs are

**8.4 Review policy defaults**
- 3 reviews per proposal, 2 per exhibition work and performance, plus the track chair.
- Scholarship is double-blind.
- Exhibition and performance are **single-blind**, because a work's URL reveals its maker. Reviewers still don't see bios.
- Scores on a 1–5 scale for fit to theme, contribution, clarity and feasibility (scholarship), and artistic merit, fit, and feasibility in the conference's modality (art), plus an overall recommendation.
- Reviewers see the other reviews only after submitting their own.
- Track chairs write a short meta-review.
- "Accept in alternate format" is a first-class decision.

**8.5 Presenter cap.** Default: at most 2 lead or presenting roles across talks, workshops, performances and exhibition works. Panel participation does not count. Submitters are warned when they submit, and chairs are blocked from finalizing over-cap decisions without an override note.

**8.6 Membership.** What runs eliterature.org/membership, and can we read status from it? Default: chairs import a periodic CSV, and accepted presenters self-attest with a link to join.

**8.7 Accounts.** Default: magic-link email login, with ORCID as an optional link. No passwords.

**8.8 Reviewer pool across years.** Default: reviewer profiles (expertise, languages) persist across conferences only with each reviewer's opt-in. Submissions and reviews stay scoped to their conference, with retention set by the host.

**8.9 Maintainers.** Who else will touch the code after launch (Dan Cox, John Murray, UCF or Uninorte students)? Is TypeScript/React acceptable to them?

**8.10 Server and email contacts.** Who administers ELO's servers, and who controls DNS for eliterature.org? Both are needed in the first two weeks.

## 9. Delivery plan for ELO 2027 (draft; dates depend on 8.3)

The rule is **ship by phase, just ahead of when each phase is needed.** Only the submission flow has to be ready before the portal opens.

| When | Phase | Done means |
|---|---|---|
| Nov 9 – Nov 22 | Foundations | Repo scaffold, shared schema, policy/projection layer and blindness tests, magic-link auth, conference and type configuration, Docker deploy to ELO staging, ELO 2026-shaped fixtures |
| Nov 23 – Dec 20 | **Submission MVP** | Bilingual CFP page and per-type forms (word counts, co-author invites, self-ID warnings, cap warning), submitter dashboard, chair list/filter/CSV, confirmation emails, tier-M MCP (read-only), WCAG 2.1 AA pass, **dry-run CFP with committee volunteers** |
| Early – mid Jan 2027 | **Portal opens** | Production launch. **Fallback:** if the MVP is not ready by the agreed date, open on EasyChair and import submissions into ELOchair for review onward. |
| Jan – deadline | Review setup | Reviewer invites and profiles (expertise, languages), conflicts of interest, on-server embedding suggestions, assignment preview and approve, mobile review forms per pool |
| Deadline + ~6 weeks | Review and discussion | Reminders, disagreement flags, discussion threads, meta-reviews, chair MCP tools for load and coverage |
| Then | Decisions and notification | Decisions including alternate formats; cap, balance and language dashboards; templated notifications with UI approval; visa and institutional letters |
| Then | Confirmation | Accept or decline, membership, final abstract and bio, licence, recording consent, accessibility, AI disclosure, tech needs, availability; **ELMS fields for exhibition works** |
| Before the conference | Scheduling and exports | Session builder (clustering suggestions), rooms and tracks, conflict checks, time-zone preview; exports to `events.json`, ELMS `works.json`, proceedings, archive bundle |

**Immediate next step once 8.1–8.3 are answered:** turn sections 0–7 and 9 into a requirements spec with acceptance criteria per phase, and start Foundations.
