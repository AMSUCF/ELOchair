import type { ConferenceConfigInput } from "@elochair/schema";

/**
 * A made-up call for server tests, with formats and limits that stay put.
 *
 * Tests need a call whose type keys, word limits, custom fields and agreements they can rely on
 * ("talk" takes 250 to 300 words; "workshop" has a "needs" field). A real conference's
 * configuration changes whenever its organisers decide something, so tests must not be built on
 * one: seedTestCall() in fixtures.ts opens this call instead. The formats are the ones ELO 2026
 * used. Change them only together with the tests that depend on them.
 *
 * Fictional throughout (house rule 10).
 */
export const fixtureCall: ConferenceConfigInput = {
  slug: "test-call",
  year: 2027,
  placeholder: true,
  title: { en: "Test call", es: "Convocatoria de prueba", pt: "Chamada de teste" },
  theme: {
    en: "A made-up call with stable formats, for tests.",
    es: "Una convocatoria inventada con formatos estables, para pruebas.",
    pt: "Uma chamada inventada com formatos estáveis, para testes.",
  },
  host: "Universidade Inventada do Norte",
  location: {
    en: "Ciudad Ficticia, Colombia",
    es: "Ciudad Ficticia, Colombia",
    pt: "Ciudad Ficticia, Colômbia",
  },
  modality: "hybrid",
  timezone: "America/Bogota",
  defaultLanguage: "en",
  languages: ["en", "es", "pt"],
  contactEmail: "call@example.org",
  dates: { start: "2027-08-03", end: "2027-08-06" },
  deadlines: {
    submissionsOpen: "2027-01-11T00:00:00-05:00",
    submissionsClose: "2027-02-14T23:59:00-12:00",
    notification: "2027-04-30T23:59:00-05:00",
    finalMaterials: "2027-05-31T23:59:00-05:00",
  },
  rules: {
    presenterCap: { max: 2, countedRoles: ["lead", "presenter"] },
    bio: { requested: true, maxWords: 300 },
  },
  // Made-up policies. Their keys and versions are what tests acknowledge.
  agreements: [
    {
      key: "privacy",
      version: "draft-1",
      title: {
        en: "Privacy notice: how ELO uses your personal data",
        es: "Aviso de privacidad: cómo usa la ELO tus datos personales",
        pt: "Aviso de privacidade: como a ELO usa os seus dados pessoais",
      },
      text: {
        en: "ELO stores your name, email, affiliation and submissions to run the conference review and program, and publishes accepted work in the open-access archive. Placeholder text pending ELO's privacy notice.",
        es: "La ELO guarda tu nombre, correo, institución y envíos para gestionar la revisión y el programa del congreso, y publica los trabajos aceptados en el archivo de acceso abierto. Texto provisional hasta contar con el aviso de privacidad de la ELO.",
        pt: "A ELO guarda o seu nome, email, instituição e submissões para gerir a revisão e o programa do congresso, e publica os trabalhos aceites no arquivo de acesso aberto. Texto provisório até existir o aviso de privacidade da ELO.",
      },
    },
    {
      key: "code_of_conduct",
      version: "draft-1",
      title: {
        en: "ELO Code of Conduct",
        es: "Código de conducta de la ELO",
        pt: "Código de conduta da ELO",
      },
      url: "https://eliterature.org/",
    },
    {
      key: "recordings",
      version: "draft-1",
      title: {
        en: "Recordings policy: sessions are recorded and published open access",
        es: "Política de grabaciones: las sesiones se graban y se publican en acceso abierto",
        pt: "Política de gravações: as sessões são gravadas e publicadas em acesso aberto",
      },
      text: {
        en: "Sessions are recorded and published open access after the conference. Placeholder text pending ELO's recordings policy.",
        es: "Las sesiones se graban y se publican en acceso abierto después del congreso. Texto provisional hasta contar con la política de grabaciones de la ELO.",
        pt: "As sessões são gravadas e publicadas em acesso aberto depois do congresso. Texto provisório até existir a política de gravações da ELO.",
      },
    },
  ],
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
      durationMinutes: 60,
      team: { min: 1, max: 6 },
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
