# ELOchair

A submission and peer-review system, in the spirit of EasyChair, built around how the [Electronic Literature Organization](https://eliterature.org) runs its annual conference and media arts festival. That means:

- submission types that change from year to year (talks, panels, workshops, performances, exhibition works, experimental formats)
- separate scientific and artistic review
- blind review that does not depend on submitters remembering to anonymize
- English, Spanish and Portuguese throughout
- open-access archiving after the conference

It is mobile-first, and chairs can run it through agents, with submission content kept off cloud models. The first real use is **ELO 2027 at Universidad del Norte, Barranquilla**.

## Status

**Foundations are done** ([spec 01](docs/specs/01-foundations.md)):
- the shared schema and the ELO 2026 configuration
- the visibility policy, with property-based blindness tests
- the API with magic-link sign-in, tiered agent tokens and an audit log
- the mobile web shell in three languages
- Docker deployment

**Next is the Submission MVP**: submission forms, co-authors, self-identification warnings, and read-only agent tools over MCP. See the [plan](docs/discovery/2026-11-08-discovery-and-draft-plan.md) §9.

## Try it

```bash
npm ci
SEED_ON_START=1 npm run dev   # API on :8080, with ELO 2026, an ELO 2027 placeholder and a synthetic sandbox
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
