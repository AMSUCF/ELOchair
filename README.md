# ELOchair

A submission and peer-review system, in the spirit of EasyChair, built around how the [Electronic Literature Organization](https://eliterature.org) runs its annual conference and media arts festival. That means:

- submission types that change from year to year (talks, panels, workshops, performances, exhibition works, experimental formats)
- separate scientific and artistic review
- blind review that does not depend on submitters remembering to anonymize
- English, Spanish and Portuguese throughout
- open-access archiving after the conference

It is mobile-first, and chairs can run it through agents, with submission content kept off cloud models. The first real use is **ELO 2027 at Universidad del Norte, Barranquilla**.

## Status

- **Foundations are done** ([spec 01](docs/specs/01-foundations.md)): schema, visibility policy with blindness tests, sign-in, tiered agent access, audit log, mobile web shell, Docker deployment.
- **The Submission MVP is built** ([spec 02](docs/specs/02-submission-mvp.md)):
  - proposals from a phone: drafts, word counts, self-identification warnings
  - co-authors invited by email who confirm or decline by link
  - consent to the conference's agreements, receipts, withdrawal
  - a chair page with counts, filters and CSV exports
  - read-only MCP tools for chairs' agents

  It has been through three rounds of adversarial review ([spec 02 §4](docs/specs/02-submission-mvp.md#4-review-before-the-dry-run)) and is awaiting the Barranquilla CFP and a dry run with committee volunteers.

## Try it

```bash
npm ci
SEED_ON_START=1 npm run dev   # API on :8080: ELO 2026, an ELO 2027 placeholder, a synthetic sandbox,
                              # and "elo2027-open", a test call that is always open
npm run dev:web               # open http://localhost:5173
```

Sign in as `chair@example.org`; the sign-in link appears in the server's log. The sandbox data is fictional and shaped like ELO 2026: 200 submissions and 41 reviewers.

```bash
npm run check   # lint, typecheck, unit and property tests
npm run e2e     # phone-size browser tests with accessibility checks
```

## Read next

- [AGENTS.md](AGENTS.md): repository map, commands and house rules, for people and coding agents
- [deploy/README.md](deploy/README.md): running ELOchair on ELO's server
- [docs/](docs/): discovery notes, plan and specs
