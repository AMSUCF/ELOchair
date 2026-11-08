import type { ConferenceConfigInput } from "../config";

/**
 * ELO 2027, Universidad del Norte, Barranquilla. PLACEHOLDER DRAFT.
 *
 * Built from the 2026 submission types and the defaults agreed on 2026-11-08 (single-blind for
 * exhibition and performance, a cap of two lead/presenter roles excluding panels). Dates,
 * modality, theme, tracks and topics are stand-ins until the Barranquilla team's CFP arrives.
 * The Spanish and Portuguese text is machine-drafted and needs review by native speakers.
 */
export const elo2027: ConferenceConfigInput = {
  slug: "elo2027",
  year: 2027,
  placeholder: true,
  title: { en: "ELO 2027", es: "ELO 2027", pt: "ELO 2027" },
  theme: {
    en: "Theme to be announced.",
    es: "Tema por anunciar.",
    pt: "Tema a anunciar.",
  },
  host: "Universidad del Norte",
  location: {
    en: "Barranquilla, Colombia",
    es: "Barranquilla, Colombia",
    pt: "Barranquilla, Colômbia",
  },
  modality: "hybrid",
  timezone: "America/Bogota",
  defaultLanguage: "en",
  languages: ["en", "es", "pt"],
  contactEmail: "elo2027@eliterature.org",
  dates: { start: "2027-07-14", end: "2027-07-17" },
  deadlines: {
    submissionsOpen: "2027-01-11T00:00:00-05:00",
    submissionsClose: "2027-03-01T23:59:00-05:00",
    notification: "2027-04-30T23:59:00-05:00",
    finalMaterials: "2027-05-31T23:59:00-05:00",
  },
  rules: { presenterCap: { max: 2, countedRoles: ["lead", "presenter"] } },
  tracks: [],
  topics: [],
  reviewPools: [
    {
      key: "scientific",
      name: { en: "Scientific committee", es: "Comité científico", pt: "Comissão científica" },
      blindMode: "double",
      reviewsPerSubmission: 3,
      criteria: [
        {
          key: "fit",
          label: {
            en: "Fit with the theme and the ELO community",
            es: "Pertinencia con el tema y la comunidad ELO",
            pt: "Adequação ao tema e à comunidade ELO",
          },
        },
        {
          key: "contribution",
          label: {
            en: "Contribution to the field",
            es: "Contribución al campo",
            pt: "Contribuição para o campo",
          },
        },
        { key: "clarity", label: { en: "Clarity", es: "Claridad", pt: "Clareza" } },
        {
          key: "feasibility",
          label: {
            en: "Feasibility for the format",
            es: "Viabilidad para el formato",
            pt: "Viabilidade para o formato",
          },
        },
      ],
    },
    {
      key: "artistic",
      name: { en: "Artistic committee", es: "Comité artístico", pt: "Comissão artística" },
      blindMode: "single",
      reviewsPerSubmission: 2,
      criteria: [
        {
          key: "merit",
          label: { en: "Artistic merit", es: "Mérito artístico", pt: "Mérito artístico" },
        },
        {
          key: "fit",
          label: {
            en: "Fit with the theme and the ELO community",
            es: "Pertinencia con el tema y la comunidad ELO",
            pt: "Adequação ao tema e à comunidade ELO",
          },
        },
        {
          key: "feasibility",
          label: {
            en: "Feasibility in the conference modality",
            es: "Viabilidad en la modalidad del congreso",
            pt: "Viabilidade na modalidade do congresso",
          },
        },
      ],
    },
  ],
  submissionTypes: [
    {
      key: "panel",
      name: { en: "Panel or roundtable", es: "Panel o mesa redonda", pt: "Painel ou mesa-redonda" },
      description: {
        en: "3 to 6 participants in a 75-minute session. Prioritize engaging formats over a series of long talks.",
        es: "De 3 a 6 participantes en una sesión de 75 minutos. Se priorizan formatos participativos sobre una serie de ponencias largas.",
        pt: "De 3 a 6 participantes numa sessão de 75 minutos. Priorizem formatos envolventes em vez de uma série de falas longas.",
      },
      reviewPool: "scientific",
      abstract: {
        label: {
          en: "Session abstract (anonymized)",
          es: "Resumen de la sesión (anonimizado)",
          pt: "Resumo da sessão (anonimizado)",
        },
        minWords: 350,
        maxWords: 500,
      },
      durationMinutes: 75,
      team: { min: 3, max: 6 },
      countsTowardPresenterCap: false,
    },
    {
      key: "talk",
      name: { en: "Individual talk", es: "Ponencia individual", pt: "Comunicação individual" },
      description: {
        en: "A 10 to 12-minute talk, grouped into sessions by theme.",
        es: "Una ponencia de 10 a 12 minutos, agrupada en sesiones temáticas.",
        pt: "Uma comunicação de 10 a 12 minutos, agrupada em sessões temáticas.",
      },
      reviewPool: "scientific",
      abstract: {
        label: {
          en: "Abstract (anonymized)",
          es: "Resumen (anonimizado)",
          pt: "Resumo (anonimizado)",
        },
        minWords: 250,
        maxWords: 300,
      },
      durationMinutes: 12,
      team: { min: 1, max: 4 },
    },
    {
      key: "workshop",
      name: { en: "Workshop", es: "Taller", pt: "Oficina" },
      description: {
        en: "Hands-on sessions on skills, technologies, platforms, and techniques of electronic literature.",
        es: "Sesiones prácticas sobre habilidades, tecnologías, plataformas y técnicas de la literatura electrónica.",
        pt: "Sessões práticas sobre competências, tecnologias, plataformas e técnicas da literatura eletrónica.",
      },
      reviewPool: "scientific",
      abstract: {
        label: {
          en: "Abstract (anonymized)",
          es: "Resumen (anonimizado)",
          pt: "Resumo (anonimizado)",
        },
        minWords: 250,
        maxWords: 300,
      },
      durationMinutes: 75,
      team: { min: 1, max: 4 },
      fields: [
        {
          key: "needs",
          label: {
            en: "Technical needs and timeslot requirements",
            es: "Necesidades técnicas y de horario",
            pt: "Necessidades técnicas e de horário",
          },
          kind: "longtext",
          maxWords: 200,
        },
      ],
    },
    {
      key: "performance",
      name: { en: "Performance", es: "Performance", pt: "Performance" },
      description: {
        en: "A 10 to 15-minute performance or reading. Describe any technical requirements.",
        es: "Una performance o lectura de 10 a 15 minutos. Describa los requisitos técnicos.",
        pt: "Uma performance ou leitura de 10 a 15 minutos. Descreva os requisitos técnicos.",
      },
      reviewPool: "artistic",
      abstract: {
        label: { en: "Artist statement", es: "Declaración artística", pt: "Declaração artística" },
        minWords: 350,
        maxWords: 500,
      },
      durationMinutes: 15,
      team: { min: 1, max: 6 },
      fields: [
        {
          key: "tech_requirements",
          label: {
            en: "Technical requirements",
            es: "Requisitos técnicos",
            pt: "Requisitos técnicos",
          },
          kind: "longtext",
          maxWords: 200,
        },
        {
          key: "work_url",
          label: {
            en: "Link to the work or documentation (optional)",
            es: "Enlace a la obra o documentación (opcional)",
            pt: "Ligação para a obra ou documentação (opcional)",
          },
          kind: "url",
          identifying: true,
          public: true,
        },
      ],
    },
    {
      key: "exhibition",
      name: { en: "Exhibition work", es: "Obra para la exposición", pt: "Obra para a exposição" },
      description: {
        en: "A work of electronic literature or media art for the exhibition.",
        es: "Una obra de literatura electrónica o arte de los medios para la exposición.",
        pt: "Uma obra de literatura eletrónica ou arte dos media para a exposição.",
      },
      reviewPool: "artistic",
      abstract: {
        label: { en: "Artist statement", es: "Declaración artística", pt: "Declaração artística" },
        minWords: 350,
        maxWords: 500,
      },
      team: { min: 1, max: 8 },
      fields: [
        {
          key: "work_url",
          label: {
            en: "URL of the work or a demonstration in progress",
            es: "URL de la obra o de una demostración en curso",
            pt: "URL da obra ou de uma demonstração em curso",
          },
          kind: "url",
          identifying: true,
          public: true,
        },
        {
          key: "tools_disclosure",
          label: {
            en: "Platforms and tools used, including any generative or agentic AI",
            es: "Plataformas y herramientas utilizadas, incluida cualquier IA generativa o agéntica",
            pt: "Plataformas e ferramentas utilizadas, incluindo qualquer IA generativa ou agêntica",
          },
          kind: "longtext",
          required: true,
          maxWords: 300,
        },
      ],
    },
    {
      key: "experimental",
      name: { en: "Experimental format", es: "Formato experimental", pt: "Formato experimental" },
      description: {
        en: "Sessions on alternative platforms and modalities. Hosts handle access and moderation.",
        es: "Sesiones en plataformas y modalidades alternativas. Quienes las proponen gestionan el acceso y la moderación.",
        pt: "Sessões em plataformas e modalidades alternativas. Quem propõe gere o acesso e a moderação.",
      },
      reviewPool: "scientific",
      abstract: {
        label: {
          en: "Session abstract (anonymized)",
          es: "Resumen de la sesión (anonimizado)",
          pt: "Resumo da sessão (anonimizado)",
        },
        minWords: 350,
        maxWords: 500,
      },
      durationMinutes: 75,
      team: { min: 1, max: 6 },
      fields: [
        {
          key: "platform",
          label: {
            en: "Proposed platform or modality, with access and environmental considerations",
            es: "Plataforma o modalidad propuesta, con consideraciones de acceso e impacto ambiental",
            pt: "Plataforma ou modalidade proposta, com considerações de acesso e impacto ambiental",
          },
          kind: "longtext",
          required: true,
          maxWords: 200,
        },
      ],
    },
  ],
};
