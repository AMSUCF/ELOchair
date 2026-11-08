# ELOchair: discovery notes and draft plan

**Date:** 2026-11-08
**Status:** Draft for discussion. Nothing here has been decided yet.

ELOchair is meant to be a submission and peer-review system, in the spirit of EasyChair, built around how the Electronic Literature Organization actually runs its annual conference and media arts festival.

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
7. **Human judgment at the centre.** Any computational assistance (reviewer matching, session clustering, translation help) is opt-in, visible to everyone affected, and never writes reviews or makes decisions. Given ELO's 2026 theme, the conference's own choices here will be read closely.

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

## 6. Architecture options (my current lean is in bold)

**A. Custom web application** (for example Django or Rails with Postgres; magic-link and ORCID login).
Fits every ELO particular and could become a scholarly or critical-making artifact in its own right. Costs: ongoing maintenance, security responsibility for personal data and confidential reviews, and a successor developer every few years.

**B. Adapt an open-source conference system, most plausibly pretalx** (Django; CfP with submission types and tracks; custom questions; speaker profiles kept separate from proposals; review phases and score categories; anonymized review; schedule editor; built-in interface translations; plugin API). ELO-specific parts would be written as plugins and exporters: presenter cap, membership, alternate-format decisions, ELMS, bepress, proceedings. HotCRP is stronger on blind review and conflicts of interest but is built around papers.
*These feature claims are from memory and need a hands-on spike before we commit.*

**C. Static front end plus a hosted backend** (for example GitHub Pages plus Supabase or Firebase).
Cheapest to run and closest to how ELO's current sites are built. Blind review then depends on row-level security being exactly right, and it creates a vendor dependency.

**Lean:** do a one- to two-week spike that tests **B** against the requirements in sections 2–5, using the ELO 2026 types and a synthetic set of 150 submissions.
- If it covers about 80%, build the ELO layer as plugins plus a standalone export toolkit. The archive-out pipeline is the uniquely ELO part and is worth owning either way.
- If it doesn't, build **A** on deliberately boring technology.
- Make the export toolkit platform-independent in both cases, so it can also ingest EasyChair or STARS exports from past years.

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

## 8. Open questions

These are in priority order. Answers will reshape the plan.

**Scope and timing**
1. Which conference is the first real use: ELO 2027 in Barranquilla, or a pilot first? Has the 2027 team picked a platform? If ELO 2027 is the target, the portal would need to open around December 2026 to January 2027.
2. Conference only, or also the exhibition and performance juries, ELC volumes, and ELO prizes (Coover, Hayles, and others)? ELC5's Round 0 and Round 1 look like the same problem.
3. Is this an ELO organizational tool (owned and hosted by ELO, handed host to host), a UCF tool, or a research and critical-making project of your own that ELO may adopt?

**Pain points**
4. What specifically went wrong or felt heavy with STARS in 2024 and 2026, and with EasyChair in 2021, 2022 and 2025? For example: reviewer assignment, anonymization slips, presenter cap, scheduling, emails, membership chasing, final-materials collection, proceedings assembly.
5. Roughly how many submissions and reviewers did 2024 and 2026 have, and how many reviews per submission? (2026 scheduled 108 events and credited 41 reviewers.)

**Review policy**
6. Should exhibition and performance be double-blind, single-blind, or juried/curated?
7. What review form do you want per pool: scores (which criteria, which scale), comments to authors, confidential comments, recommended format?
8. Should reviewers see other reviews after submitting their own? Is there a discussion phase, or meta-review by track chairs?
9. Should "accept in an alternate format" be a first-class decision?
10. Exact presenter-cap rule: what counts (lead, presenter, first author), do panels count, and should it warn at submission or block at decision time?

**People and integration**
11. What does ELO membership run on (the platform behind eliterature.org/membership)? Can we read status via an API or a periodic CSV, or is it confirmed manually?
12. Should one reviewer pool persist across years (with consent), or should each conference start fresh?
13. Which roles need admin access: ELO coordinator, co-chairs, track chairs, exhibition chairs, proceedings chair, web chair?

**Language, modality, logistics**
14. Languages for ELO 2027: interface and submissions in English and Spanish (plus Portuguese)? Should reviewers be matched by language?
15. Modality: in person, hybrid, or online? Collect presenter availability and time-zone windows? Generate visa and institutional letters?

**AI and computation**
16. What is your stance on computational assistance: none; chairs-only suggestions (reviewer matching, session clustering) using local or small models; or more (translation, summaries)? Should ELOchair publish its own AI-use statement?

**Outputs**
17. After 2026, where does the open-access record live: STARS (if UCF keeps hosting ELO's archive), an ELO-run repository, Zenodo, or `eliterature/archives`? Should ELOchair generate the public program and proceedings itself, or only export?

**Operations**
18. Hosting: ELO's servers (WSU Vancouver's Electronic Literature Lab manages ELO servers), UCF, or a managed cloud? What budget, if any?
19. Who maintains it after the first year, and what is their stack comfort (Python, JavaScript, PHP)?
20. Email: send from an `eliterature.org` address? Is there an existing transactional mail service?

## 9. Proposed next steps (after answers)

1. Lock scope and the first target conference. Write a one-page requirements spec with acceptance criteria per phase.
2. Run the spike (section 6). Score the candidates against the requirements using synthetic ELO 2026-shaped data.
3. Build the export toolkit first (`events.json`, ELMS, bepress batch, proceedings). It pays off whatever platform is chosen, and it can be tested against the 2026 data already in `AMSUCF/ELO2026`.
4. Build the submission and review flow, then pilot it with a dry-run CFP among committee volunteers before any public launch.
