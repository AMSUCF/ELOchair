import type { ConferenceConfigInput } from "../config";

/**
 * ELO 2026 "(un)supervised", encoded from the published CFP (AMSUCF/ELO2026 cfp.md).
 * A historical reference and test fixture: it records what 2026 actually did, e.g.
 * performance statements were anonymized (double-blind) while exhibition pieces were not.
 * Reviews per submission and scoring criteria were not published; they use the 2027 defaults.
 * Where the CFP is silent, values come from the 2026 schedule (AMSUCF/ELO2026 data/events.json):
 * workshops ran in 60-minute blocks, one with five facilitators; experimental sessions had no
 * fixed length (60 and 225 minutes), so none is set. The presenter cap is not in the 2026 CFP;
 * it carries over the cap the 2024 CFP stated (two lead/presenting roles, panels excluded).
 */
export const elo2026: ConferenceConfigInput = {
  slug: "elo2026",
  year: 2026,
  title: { en: "ELO 2026: (un)supervised" },
  theme: {
    en: "Who is watching, who is reading, and who is learning about electronic literature; generativity, computational creativity, and the university as contested spaces.",
  },
  host: "University of Central Florida",
  location: { en: "Online (hosted from Orlando, Florida)" },
  modality: "online",
  timezone: "America/New_York",
  defaultLanguage: "en",
  languages: ["en"],
  contactEmail: "anastasia@ucf.edu",
  dates: { start: "2026-07-15", end: "2026-07-18" },
  deadlines: {
    submissionsOpen: "2025-12-01T00:00:00-05:00",
    submissionsClose: "2026-02-28T23:59:00-05:00",
    notification: "2026-04-30T23:59:00-04:00",
    finalMaterials: "2026-05-15T23:59:00-04:00",
  },
  rules: { presenterCap: { max: 2, countedRoles: ["lead", "presenter"] } },
  tracks: [
    { key: "algorithms_imaginaries", name: { en: "Algorithms & Imaginaries" } },
    { key: "hypertexts_fictions", name: { en: "Hypertexts & Fictions" } },
    { key: "narratives_worlds", name: { en: "Narratives & Worlds" } },
  ],
  topics: [
    { key: "access_archivism", label: { en: "E-Lit Access, Anthologies, + Archivism" } },
    {
      key: "networks_platforms",
      label: { en: "Emerging + Migrating E-Lit Networks, Community, + Platforms" },
    },
    {
      key: "critical_making_dh",
      label: { en: "Critical Making, Digital Humanities, + E-Lit Criticism" },
    },
    { key: "generative_ai", label: { en: "Generative / Agentic AI + Computational Creativity" } },
    {
      key: "institutional_imaginaries",
      label: { en: "Institutional Imaginaries After Federal Withdrawal" },
    },
    { key: "resistance", label: { en: "Theories, Aesthetics, + Praxes of Resistance" } },
    { key: "edu_labor", label: { en: "Anti-Racist, Feminist, + Queer Edu-Labor" } },
    { key: "twine_hypertext", label: { en: "Twine + Hypertext [Non]Fictions & Poetics" } },
    { key: "xr", label: { en: "Mixed + Extended Reality + Imaginaries" } },
  ],
  reviewPools: [
    {
      key: "scientific",
      name: { en: "Scientific committee" },
      blindMode: "double",
      reviewsPerSubmission: 3,
      criteria: [
        { key: "fit", label: { en: "Fit with the theme and the ELO community" } },
        { key: "contribution", label: { en: "Contribution to the field" } },
        { key: "clarity", label: { en: "Clarity" } },
        { key: "feasibility", label: { en: "Feasibility for the format" } },
      ],
    },
    {
      key: "artistic",
      name: { en: "Artistic committee" },
      blindMode: "single",
      reviewsPerSubmission: 2,
      criteria: [
        { key: "merit", label: { en: "Artistic merit" } },
        { key: "fit", label: { en: "Fit with the theme and the ELO community" } },
        { key: "feasibility", label: { en: "Feasibility in the conference modality" } },
      ],
    },
  ],
  submissionTypes: [
    {
      key: "panel",
      name: { en: "Panel or roundtable" },
      description: {
        en: "3 to 6 participants, scheduled live on Zoom in 75-minute blocks. Prioritize engaging formats over a series of long talks.",
      },
      reviewPool: "scientific",
      abstract: { label: { en: "Session abstract (anonymized)" }, minWords: 350, maxWords: 500 },
      durationMinutes: 75,
      team: { min: 3, max: 6 },
      countsTowardPresenterCap: false,
    },
    {
      key: "talk",
      name: { en: "Individual talk" },
      description: { en: "A 10 to 12-minute talk, grouped into sessions by theme." },
      reviewPool: "scientific",
      abstract: { label: { en: "Abstract (anonymized)" }, minWords: 250, maxWords: 300 },
      durationMinutes: 12,
      team: { min: 1, max: 4 },
    },
    {
      key: "workshop",
      name: { en: "Workshop" },
      description: {
        en: "Hands-on sessions on skills, technologies, platforms, and techniques for practitioners and scholars of electronic literature.",
      },
      reviewPool: "scientific",
      abstract: { label: { en: "Abstract (anonymized)" }, minWords: 250, maxWords: 300 },
      durationMinutes: 60,
      team: { min: 1, max: 6 },
      fields: [
        {
          key: "needs",
          label: { en: "Needs and timeslot requirements" },
          kind: "longtext",
          maxWords: 200,
        },
      ],
    },
    {
      key: "performance",
      name: { en: "Performance" },
      description: {
        en: "A 10 to 12-minute performance suited to Zoom; making use of the distant modality and interface is encouraged.",
      },
      reviewPool: "artistic",
      blindMode: "double",
      abstract: {
        label: { en: "Artist statement (anonymized)" },
        minWords: 350,
        maxWords: 500,
      },
      durationMinutes: 12,
      team: { min: 1, max: 6 },
    },
    {
      key: "exhibition",
      name: { en: "Online exhibition" },
      description: {
        en: "Web-deployable work using web-standard technologies, hosted on UCF's server space.",
      },
      reviewPool: "artistic",
      abstract: { label: { en: "Artist statement" }, minWords: 350, maxWords: 500 },
      team: { min: 1, max: 8 },
      fields: [
        {
          key: "work_url",
          label: { en: "URL of the work or a demonstration of the concept in progress" },
          kind: "url",
          identifying: true,
          public: true,
        },
        {
          key: "tools_disclosure",
          label: {
            en: "Disclosure and reflection on platforms or tools used, particularly generative or agentic AI",
          },
          kind: "longtext",
          required: true,
          maxWords: 300,
        },
      ],
    },
    {
      key: "experimental",
      name: { en: "Experimental track" },
      description: {
        en: "Sessions on alternative platforms and modalities, from text chat to in-game meetings. Hosts handle access and moderation.",
      },
      reviewPool: "scientific",
      abstract: { label: { en: "Session abstract (anonymized)" }, minWords: 350, maxWords: 500 },
      team: { min: 1, max: 6 },
      fields: [
        {
          key: "platform",
          label: {
            en: "Proposed platform or modality, with access and environmental considerations",
          },
          kind: "longtext",
          required: true,
          maxWords: 200,
        },
      ],
    },
  ],
};
