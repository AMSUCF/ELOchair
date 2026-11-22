import type { ConferenceConfigInput } from "../config";

/**
 * ELO 2027, Universidad del Norte, Barranquilla. STILL PROVISIONAL (placeholder: true).
 *
 * From the call published at https://elo27.eliterature.org/ (read 2026-11-10): the theme, the
 * conference dates (August 3 is the Lit(e)Lat network encounter, August 4–6 the conference),
 * the submission deadline (February 14, 2027, 23:59 anywhere on Earth, which is UTC-12), the
 * contact address, the website and the coordinates.
 *
 * Also from the call: the formats (seven are submitted here; curatorial pitches go by email),
 * and the languages submissions may be written in. See the note above submissionTypes for what
 * the call leaves open.
 *
 * Not from the call, and still stand-ins: the day submissions open, the notification and
 * final-materials dates, and the agreements.
 *
 * The invitation, the line about Latin America and the ways to contribute are the wording of
 * the design preview (docs/design/visitor-preview/copy.js), in English and Spanish. It was
 * checked against the conference site's source on 2026-11-16; the invitation is new copy based
 * on the call's theme statement, not a quotation. Each group holds the formats its line names.
 *
 * The Spanish theme is the call's own wording. The other Spanish text and all the Portuguese
 * are machine-drafted and need review by native speakers.
 */
export const elo2027: ConferenceConfigInput = {
  slug: "elo2027",
  year: 2027,
  placeholder: true,
  title: { en: "ELO 2027", es: "ELO 2027", pt: "ELO 2027" },
  theme: {
    en: "Ecologies of Attention",
    es: "Ecologías de la atención",
    pt: "Ecologias da atenção",
  },
  distinction: {
    en: "ELO’s first conference in Latin America",
    es: "Primer congreso de ELO en América Latina",
    pt: "Primeiro congresso da ELO na América Latina",
  },
  invitation: {
    en: "We invite work that engages attention as a political, ecological and poetic condition, and the practices through which electronic literature trains, reshapes and resists the overload that keeps it fragmented.",
    es: "Invitamos propuestas que aborden la atención como condición política, ecológica y poética, y las prácticas con las que la literatura electrónica la entrena, la transforma y resiste la sobrecarga que la mantiene fragmentada.",
    pt: "Convidamos propostas que abordem a atenção como condição política, ecológica e poética, e as práticas com que a literatura eletrónica a treina, a transforma e resiste à sobrecarga que a mantém fragmentada.",
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
  // Submissions are welcome in English or Spanish. The interface is also in Portuguese.
  languages: ["en", "es"],
  contactEmail: "elo27@uninorte.edu.co",
  website: "https://elo27.eliterature.org/",
  coordinates: { lat: 10.96, lon: -74.8 },
  dates: { start: "2027-08-03", end: "2027-08-06" },
  deadlines: {
    submissionsOpen: "2027-01-11T00:00:00-05:00",
    // February 14, 2027, 23:59 anywhere on Earth (UTC-12).
    submissionsClose: "2027-02-14T23:59:00-12:00",
    notification: "2027-04-30T23:59:00-05:00",
    finalMaterials: "2027-05-31T23:59:00-05:00",
  },
  rules: {
    presenterCap: { max: 2, countedRoles: ["lead", "presenter"] },
    bio: { requested: true, maxWords: 300 },
  },
  // PLACEHOLDERS: replace with ELO's actual policy texts before the call opens.
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
  /*
   * The call's formats (https://elo27.eliterature.org/, read 2026-11-10). Names and limits are
   * the call's. Where the call says nothing, the defaults agreed on 2026-11-08 stand, and each
   * is a question for the organisers:
   * - Minimum lengths: none given, so the formats have no minWords: an abstract only has to be
   *   there.
   * - Review: the call's "academic" formats go to the scientific pool (anonymized, three
   *   reviews), its "artistic" ones to the artistic pool (names visible, two reviews).
   * - Team sizes, and panels not counting toward the cap of two. A panel may have up to 24
   *   people, so that co-authors of its papers are never refused.
   * - Bios: the call asks for 250 words (200-300 for the exhibition). ELOchair has one limit for
   *   the whole conference (rules.bio above) until bios can differ by format.
   * - Panels: the call asks for an abstract per paper. Until submissions can hold those as
   *   separate items, they go in one field.
   */
  submissionTypes: [
    {
      key: "talk",
      name: { en: "Paper", es: "Ponencia", pt: "Comunicação" },
      description: {
        en: "A 15-minute paper. Experimental and research-creation forms of writing are encouraged. There will be an opportunity to submit full papers for the published proceedings.",
        es: "Una ponencia de 15 minutos. Se alientan formas de escritura experimentales y de investigación-creación. Habrá oportunidad de enviar textos completos para las memorias publicadas.",
        pt: "Uma comunicação de 15 minutos. Incentivam-se formas de escrita experimentais e de investigação-criação. Haverá oportunidade de enviar textos completos para as atas publicadas.",
      },
      reviewPool: "scientific",
      abstract: {
        label: {
          en: "Abstract (anonymized)",
          es: "Resumen (anonimizado)",
          pt: "Resumo (anonimizado)",
        },
        maxWords: 300,
      },
      durationMinutes: 15,
      team: { min: 1, max: 4 },
    },
    {
      key: "lightning",
      name: { en: "Lightning talk", es: "Charla relámpago", pt: "Comunicação relâmpago" },
      description: {
        en: "A 5-minute talk.",
        es: "Una charla de 5 minutos.",
        pt: "Uma comunicação de 5 minutos.",
      },
      reviewPool: "scientific",
      abstract: {
        label: {
          en: "Abstract (anonymized)",
          es: "Resumen (anonimizado)",
          pt: "Resumo (anonimizado)",
        },
        maxWords: 150,
      },
      durationMinutes: 5,
      team: { min: 1, max: 4 },
    },
    {
      key: "panel",
      name: { en: "Panel", es: "Panel", pt: "Painel" },
      description: {
        en: "Three to four 15-minute papers, or five to six 5-minute lightning talks, proposed together, with a short rationale for the panel as a whole.",
        es: "De tres a cuatro ponencias de 15 minutos, o de cinco a seis charlas relámpago de 5 minutos, propuestas en conjunto, con una justificación breve del panel.",
        pt: "De três a quatro comunicações de 15 minutos, ou de cinco a seis comunicações relâmpago de 5 minutos, propostas em conjunto, com uma justificação breve do painel.",
      },
      reviewPool: "scientific",
      abstract: {
        label: {
          en: "Rationale for the panel (anonymized)",
          es: "Justificación del panel (anonimizada)",
          pt: "Justificação do painel (anonimizada)",
        },
        maxWords: 150,
      },
      // At least three papers, so three people. At most six talks, each with up to four authors
      // (the most a paper or a lightning talk may have): 24. The call gives no figure.
      team: { min: 3, max: 24 },
      countsTowardPresenterCap: false,
      fields: [
        {
          key: "paper_abstracts",
          label: {
            en: "Abstract of each paper or talk (anonymized)",
            es: "Resumen de cada ponencia o charla (anonimizado)",
            pt: "Resumo de cada comunicação (anonimizado)",
          },
          help: {
            en: "One after another, each with its title: up to 150 words each.",
            es: "Uno tras otro, cada uno con su título: hasta 150 palabras cada uno.",
            pt: "Um a seguir ao outro, cada um com o seu título: até 150 palavras cada.",
          },
          kind: "longtext",
          required: true,
          // Six abstracts of 150 words, and room for their titles.
          maxWords: 1000,
        },
      ],
    },
    {
      key: "artist_talk",
      name: { en: "Artist talk", es: "Charla de artista", pt: "Conversa de artista" },
      description: {
        en: "A 15-minute slot for e-lit practitioners to discuss their own works, as distinct from performing or reading them. If you mainly wish to read or perform, choose a reading or performance instead.",
        es: "Un espacio de 15 minutos para que creadoras y creadores de e-lit discutan sus propias obras (distinto de una lectura o performance de la obra). Si deseas principalmente leer o realizar una performance, elige esa opción.",
        pt: "Um espaço de 15 minutos para que criadoras e criadores de e-lit discutam as suas próprias obras (diferente de uma leitura ou performance da obra). Se pretende sobretudo ler ou apresentar uma performance, escolha essa opção.",
      },
      reviewPool: "scientific",
      abstract: {
        label: {
          en: "Abstract (anonymized)",
          es: "Resumen (anonimizado)",
          pt: "Resumo (anonimizado)",
        },
        maxWords: 300,
      },
      durationMinutes: 15,
      team: { min: 1, max: 4 },
    },
    {
      key: "workshop",
      name: { en: "Workshop", es: "Taller", pt: "Oficina" },
      description: {
        en: "A 1-hour workshop of hands-on interaction, discussion and instruction on a topic relevant to e-lit.",
        es: "Un taller de 1 hora de trabajo práctico, discusión e instrucción sobre un tema relevante para la e-lit.",
        pt: "Uma oficina de 1 hora de trabalho prático, discussão e instrução sobre um tema relevante para a e-lit.",
      },
      reviewPool: "scientific",
      abstract: {
        label: {
          en: "Description of the workshop and its goals (anonymized)",
          es: "Descripción del taller y sus objetivos (anonimizada)",
          pt: "Descrição da oficina e dos seus objetivos (anonimizada)",
        },
        maxWords: 300,
      },
      durationMinutes: 60,
      team: { min: 1, max: 6 },
      fields: [
        {
          key: "participants",
          label: {
            en: "Expected number of participants (between 15 and 30)",
            es: "Número previsto de participantes (entre 15 y 30)",
            pt: "Número previsto de participantes (entre 15 e 30)",
          },
          kind: "number",
          required: true,
          min: 15,
          max: 30,
          integer: true,
        },
        {
          key: "needs",
          label: {
            en: "Tools and room conditions you will need",
            es: "Herramientas y condiciones de sala necesarias",
            pt: "Ferramentas e condições de sala necessárias",
          },
          kind: "longtext",
          required: true,
          maxWords: 200,
        },
      ],
    },
    {
      key: "performance",
      name: {
        en: "Reading or performance",
        es: "Lectura o performance",
        pt: "Leitura ou performance",
      },
      description: {
        en: "A reading or a performance. A link to the work, or a detailed outline or images, is strongly encouraged.",
        es: "Una lectura o performance. Recomendamos incluir un enlace a la obra o un esquema o imágenes detalladas.",
        pt: "Uma leitura ou performance. Recomendamos incluir uma ligação para a obra ou um esquema ou imagens detalhadas.",
      },
      reviewPool: "artistic",
      abstract: {
        label: { en: "Abstract", es: "Resumen", pt: "Resumo" },
        maxWords: 300,
      },
      team: { min: 1, max: 6 },
      fields: [
        {
          key: "tech_requirements",
          label: {
            en: "Technical requirements, if any",
            es: "Requerimientos técnicos, si los hay",
            pt: "Requisitos técnicos, se os houver",
          },
          kind: "longtext",
          maxWords: 200,
        },
        {
          key: "work_url",
          label: {
            en: "Link to the work, or to a detailed outline or images (optional)",
            es: "Enlace a la obra, o a un esquema o imágenes detalladas (opcional)",
            pt: "Ligação para a obra, ou para um esquema ou imagens detalhadas (opcional)",
          },
          kind: "url",
          identifying: true,
          public: true,
        },
      ],
    },
    {
      key: "exhibition",
      name: {
        en: "Work for the exhibition",
        es: "Obra para la exposición",
        pt: "Obra para a exposição",
      },
      description: {
        en: "An artwork for the ELO 2027 festival exhibition, which is designed as a continuous space: works remain available for the whole conference. Consider how the work operates over sustained time and across multiple encounters.",
        es: "Una obra para la exposición del festival ELO 2027, que se concibe como un espacio continuo: las obras estarán disponibles durante toda la conferencia. Considera cómo opera la obra en el tiempo sostenido y a lo largo de múltiples encuentros.",
        pt: "Uma obra para a exposição do festival ELO 2027, concebida como um espaço contínuo: as obras ficam disponíveis durante toda a conferência. Considere como a obra funciona ao longo de um tempo prolongado e de múltiplos encontros.",
      },
      reviewPool: "artistic",
      abstract: {
        label: { en: "Abstract", es: "Resumen", pt: "Resumo" },
        maxWords: 300,
      },
      team: { min: 1, max: 8 },
      fields: [
        {
          key: "work_url",
          label: {
            en: "Link to the work or to documentation of it (optional)",
            es: "Enlace a la obra o a su documentación (opcional)",
            pt: "Ligação para a obra ou para a sua documentação (opcional)",
          },
          kind: "url",
          identifying: true,
          public: true,
        },
      ],
    },
  ],
  // In the call, but not submitted through ELOchair.
  otherFormats: [
    {
      key: "curatorial_pitch",
      name: { en: "Curatorial pitch", es: "Propuesta curatorial", pt: "Proposta curatorial" },
      description: {
        en: "A vision for curating a set of existing e-lit works, or for soliciting new works, around Ecologies of Attention. Capacity to support invited curators is limited. Pitches are made by email, not here: the contact address will be announced on the conference site.",
        es: "Una visión para curar un conjunto de obras de e-lit existentes, o convocar obras nuevas, en torno a Ecologías de la atención. La capacidad para apoyar curadurías invitadas es limitada. Las propuestas se envían por correo, no aquí: la dirección de contacto se anunciará en el sitio de la conferencia.",
        pt: "Uma visão para a curadoria de um conjunto de obras de e-lit existentes, ou para convocar obras novas, em torno de Ecologias da atenção. A capacidade para apoiar curadorias convidadas é limitada. As propostas enviam-se por email, não aqui: o endereço de contacto será anunciado no site da conferência.",
      },
    },
  ],
  // The ways to contribute, as the invitation groups them. Curatorial pitches are in none:
  // the invitation's lines do not name them, and they are not submitted here.
  contributionGroups: [
    {
      key: "ideas",
      name: { en: "Talks & ideas", es: "Charlas e ideas", pt: "Comunicações e ideias" },
      summary: {
        en: "Papers, lightning talks, panels and artist talks.",
        es: "Ponencias, charlas relámpago, paneles y charlas de artista.",
        pt: "Comunicações, comunicações relâmpago, painéis e conversas de artista.",
      },
      formats: ["talk", "lightning", "panel", "artist_talk"],
    },
    {
      key: "art",
      name: { en: "Art & performance", es: "Arte y performance", pt: "Arte e performance" },
      summary: {
        en: "Readings, performances and exhibition works.",
        es: "Lecturas, performances y obras para la exposición.",
        pt: "Leituras, performances e obras para a exposição.",
      },
      formats: ["performance", "exhibition"],
    },
    {
      key: "workshops",
      name: { en: "Workshops", es: "Talleres", pt: "Oficinas" },
      summary: {
        en: "Hands-on sessions for interaction and discussion.",
        es: "Sesiones prácticas de interacción y diálogo.",
        pt: "Sessões práticas de interação e diálogo.",
      },
      formats: ["workshop"],
    },
  ],
};
