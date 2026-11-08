import { type ConferenceConfig, conferences } from "@elochair/schema";
import type { Db } from "./db/client";
import {
  assignments,
  conflicts,
  contributions,
  people,
  reviewerProfiles,
  submissions,
} from "./db/schema";
import { grantRole, saveConference } from "./repo";

/*
 * Synthetic, deterministic test data shaped like ELO 2026: the same submission types, in the
 * proportions of the 2026 program (108 scheduled events plus 47 exhibition works), reviewed by
 * 41 people. Every name, email and institution is fictional; no real participant data is used.
 */

function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
  const sample = <T>(xs: readonly T[], n: number): T[] => {
    const copy = [...xs];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy.slice(0, n);
  };
  return { next, int, pick, sample };
}

const FIRST = [
  "Ana",
  "Bruno",
  "Camila",
  "Dario",
  "Elif",
  "Farah",
  "Gael",
  "Hana",
  "Iker",
  "Joana",
  "Kenji",
  "Lucía",
  "Mateus",
  "Nadia",
  "Omar",
  "Paula",
  "Quentin",
  "Rosa",
  "Sven",
  "Tomás",
  "Uma",
  "Valeria",
  "Wen",
  "Ximena",
  "Yusuf",
  "Zoe",
];
const LAST = [
  "Arboleda",
  "Brandão",
  "Castillo",
  "Duarte",
  "Esposito",
  "Ferreira",
  "Galindo",
  "Holm",
  "Ibáñez",
  "Jaramillo",
  "Kowalczyk",
  "Lindqvist",
  "Moreau",
  "Nakagawa",
  "Okafor",
  "Pereira",
  "Quintero",
  "Rossi",
  "Salcedo",
  "Takeda",
  "Urbina",
  "Vargas",
  "Weber",
  "Xu",
  "Yilmaz",
  "Zapata",
];
const INSTITUTIONS = [
  "Universidad Imaginaria del Caribe",
  "Instituto Ficticio de Poesía Digital",
  "Fictional University of Hypertext",
  "Universidade Inventada do Norte",
  "Placeholder College of Media Arts",
  "Synthetic Institute of Narrative Systems",
  "Universidad Hipotética de los Andes",
  "Example State University",
  "Imaginary Polytechnic of Code and Verse",
  "Universidade Fictícia de Literatura Eletrónica",
  "Nowhere Lab for Critical Making",
  "Independent artist",
];
const WORDS: Record<string, string[]> = {
  en: [
    "electronic",
    "literature",
    "hypertext",
    "poetry",
    "generative",
    "platform",
    "archive",
    "reader",
    "code",
    "interface",
    "network",
    "community",
    "memory",
    "machine",
    "language",
    "narrative",
    "practice",
    "play",
    "screen",
    "algorithm",
    "body",
    "care",
    "future",
    "history",
    "media",
    "making",
    "reading",
    "writing",
    "system",
    "error",
    "glitch",
    "story",
    "voice",
    "world",
    "signal",
    "pattern",
    "page",
    "link",
    "node",
    "trace",
  ],
  es: [
    "literatura",
    "electrónica",
    "hipertexto",
    "poesía",
    "generativa",
    "plataforma",
    "archivo",
    "lectura",
    "código",
    "interfaz",
    "red",
    "comunidad",
    "memoria",
    "máquina",
    "lenguaje",
    "narrativa",
    "práctica",
    "juego",
    "pantalla",
    "algoritmo",
    "cuerpo",
    "cuidado",
    "futuro",
    "historia",
    "medios",
    "escritura",
    "sistema",
    "error",
    "relato",
    "voz",
    "mundo",
    "señal",
    "patrón",
    "página",
    "enlace",
    "nodo",
    "huella",
    "cultura",
    "digital",
    "obra",
  ],
  pt: [
    "literatura",
    "eletrónica",
    "hipertexto",
    "poesia",
    "generativa",
    "plataforma",
    "arquivo",
    "leitura",
    "código",
    "interface",
    "rede",
    "comunidade",
    "memória",
    "máquina",
    "linguagem",
    "narrativa",
    "prática",
    "jogo",
    "ecrã",
    "algoritmo",
    "corpo",
    "cuidado",
    "futuro",
    "história",
    "media",
    "escrita",
    "sistema",
    "erro",
    "relato",
    "voz",
    "mundo",
    "sinal",
    "padrão",
    "página",
    "ligação",
    "nó",
    "rasto",
    "cultura",
    "digital",
    "obra",
  ],
};

/** Proportions of the ELO 2026 program, by submission type. */
const TYPE_WEIGHTS: Record<string, number> = {
  talk: 72,
  panel: 11,
  workshop: 10,
  performance: 6,
  experimental: 2,
  exhibition: 47,
};

function apportion(total: number, weights: Record<string, number>): Record<string, number> {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const raw = Object.entries(weights).map(([k, w]) => [k, (total * w) / sum] as const);
  const out = Object.fromEntries(raw.map(([k, v]) => [k, Math.floor(v)]));
  let left = total - Object.values(out).reduce((a, b) => a + b, 0);
  for (const [k] of [...raw].sort((a, b) => (b[1] % 1) - (a[1] % 1))) {
    if (left-- <= 0) break;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type SandboxSummary = {
  conferenceId: string;
  slug: string;
  adminEmail: string;
  chairEmail: string;
  trackChairEmails: string[];
  reviewerEmails: string[];
  submissionCount: number;
  assignmentCount: number;
  overCapPersonIds: string[];
};

export async function seedSandbox(
  db: Db,
  opts: { slug?: string; seed?: number; submissions?: number } = {},
): Promise<SandboxSummary> {
  const slug = opts.slug ?? "sandbox";
  const r = prng(opts.seed ?? 2026);
  const conf = await saveConference(
    db,
    {
      ...structuredClone(conferences.elo2026),
      slug,
      title: { en: "Sandbox: synthetic ELO 2026-shaped data" },
      placeholder: true,
    },
    "reviewing",
  );
  const config: ConferenceConfig = conf.config;

  // People -----------------------------------------------------------------------------------
  type P = {
    id?: string;
    email: string;
    displayName: string;
    affiliation: string;
    languages: string[];
    bio: string;
  };
  let n = 0;
  const makePerson = (): P => {
    const first = r.pick(FIRST);
    const last = r.pick(LAST);
    n++;
    return {
      email: `${ascii(first)}.${ascii(last)}.${n}@example.org`,
      displayName: `${first} ${last}`,
      affiliation: r.pick(INSTITUTIONS),
      languages: r.sample(["en", "es", "pt"], r.int(1, 3)),
      bio: `${first} ${last} is a fictional participant generated for testing ELOchair.`,
    };
  };
  const insertPeople = async (ps: P[]) => {
    const rows = await db.insert(people).values(ps).returning({ id: people.id });
    rows.forEach((row, i) => {
      (ps[i] as P).id = row.id;
    });
  };

  const admin: P = { ...makePerson(), email: "admin@example.org", displayName: "Fictional Admin" };
  const chair: P = { ...makePerson(), email: "chair@example.org", displayName: "Fictional Chair" };
  const trackChairs = config.tracks.map((_, i) => ({
    ...makePerson(),
    email: `track-chair-${i + 1}@example.org`,
  }));
  const reviewers = Array.from({ length: 41 }, (_, i) => ({
    ...makePerson(),
    email: `reviewer-${i + 1}@example.org`,
  }));
  const authors = Array.from({ length: 190 }, makePerson);
  await insertPeople([admin, chair, ...trackChairs, ...reviewers, ...authors]);
  const id = (p: P) => p.id as string;

  await grantRole(db, { conferenceId: conf.id, personId: id(admin), role: "admin" });
  await grantRole(db, { conferenceId: conf.id, personId: id(chair), role: "chair" });
  for (const [i, tc] of trackChairs.entries()) {
    const track = config.tracks[i]?.key;
    await grantRole(db, {
      conferenceId: conf.id,
      personId: id(tc),
      role: "track_chair",
      scope: track ? [track] : [],
    });
  }
  const scientific = reviewers.slice(0, 28);
  const artistic = reviewers.slice(28);
  const poolOf = new Map<string, string>();
  for (const [pool, group] of [
    ["scientific", scientific],
    ["artistic", artistic],
  ] as const) {
    for (const rv of group) {
      poolOf.set(id(rv), pool);
      await grantRole(db, {
        conferenceId: conf.id,
        personId: id(rv),
        role: "reviewer",
        scope: [pool],
      });
    }
    await db.insert(reviewerProfiles).values(
      group.map((rv) => ({
        conferenceId: conf.id,
        personId: id(rv),
        pools: [pool],
        expertise: r.sample(
          config.topics.map((t) => t.key),
          3,
        ),
        languages: rv.languages,
        maxLoad: 12,
      })),
    );
  }

  // Submissions ------------------------------------------------------------------------------
  const counts = apportion(opts.submissions ?? 200, TYPE_WEIGHTS);
  // About a quarter of reviewers also submit; the field is small.
  const submitters = [...authors, ...reviewers.slice(0, 10)];
  const overCap = authors.slice(0, 3);
  type S = typeof submissions.$inferInsert & { team: { person: P; role: string }[] };
  const subs: S[] = [];
  const capped = new Map<P, number>();
  let k = 0;
  for (const type of config.submissionTypes) {
    for (let i = 0; i < (counts[type.key] ?? 0); i++, k++) {
      const language = r.next() < 0.7 ? "en" : r.next() < 0.67 ? "es" : "pt";
      const words = WORDS[language] as string[];
      const nWords = r.int(type.abstract.minWords, type.abstract.maxWords);
      const abstract = Array.from({ length: nWords }, () => r.pick(words)).join(" ");
      const title = `${cap(r.pick(words))} ${r.pick(words)}: ${r.pick(words)} ${r.pick(words)}`;
      const fields: Record<string, string> = {};
      for (const f of type.fields) {
        fields[f.key] =
          f.kind === "url"
            ? `https://example.org/works/${k}`
            : Array.from({ length: 30 }, () => r.pick(words)).join(" ");
      }
      const size = r.int(type.team.min, Math.min(type.team.max, type.team.min + 2));
      // Everyone stays within the cap of two counted roles...
      const counts = type.countsTowardPresenterCap;
      const underCap = submitters.filter(
        (p) => !overCap.includes(p) && (!counts || (capped.get(p) ?? 0) < 2),
      );
      const people_ = r.sample(underCap, size);
      // ...except three authors, who lead three talks each.
      if (type.key === "talk" && i < 9) people_[0] = overCap[Math.floor(i / 3)] as P;
      const team = people_.map((p, j) => {
        const role =
          j === 0 ? "lead" : type.key === "panel" ? "panelist" : r.pick(["presenter", "coauthor"]);
        if (counts && (role === "lead" || role === "presenter")) {
          capped.set(p, (capped.get(p) ?? 0) + 1);
        }
        return { person: p, role };
      });
      subs.push({
        conferenceId: conf.id,
        typeKey: type.key,
        trackKey: type.key === "exhibition" ? null : r.pick(config.tracks).key,
        topicKeys: r.sample(
          config.topics.map((t) => t.key),
          r.int(1, 2),
        ),
        language,
        title,
        abstract,
        fields,
        status: "submitted",
        submittedAt: new Date(Date.UTC(2026, 1, r.int(1, 27), r.int(0, 23))),
        team,
      });
    }
  }
  const inserted = await db
    .insert(submissions)
    .values(subs.map(({ team: _team, ...s }) => s))
    .returning({ id: submissions.id });
  const subIds = inserted.map((x) => x.id);
  await db.insert(contributions).values(
    subs.flatMap((s, i) =>
      s.team.map((t, position) => ({
        submissionId: subIds[i] as string,
        personId: id(t.person),
        role: t.role,
        position,
      })),
    ),
  );

  // Conflicts: shared institutions (as the system would detect them). ------------------------
  const conflictRows: (typeof conflicts.$inferInsert)[] = [];
  const conflictPairs = new Set<string>();
  for (const s of subs) {
    for (const t of s.team) {
      for (const rv of reviewers) {
        const key = `${id(rv)}:${id(t.person)}`;
        if (
          rv !== t.person &&
          rv.affiliation === t.person.affiliation &&
          rv.affiliation !== "Independent artist" &&
          !conflictPairs.has(key)
        ) {
          conflictPairs.add(key);
          conflictRows.push({
            conferenceId: conf.id,
            personId: id(rv),
            otherPersonId: id(t.person),
            kind: "institution",
            declaredBy: "system",
          });
        }
      }
    }
  }
  if (conflictRows.length) await db.insert(conflicts).values(conflictRows);

  // Assignments: least-loaded eligible reviewers from the type's pool. ------------------------
  const load = new Map(reviewers.map((rv) => [id(rv), 0]));
  const assignmentRows: (typeof assignments.$inferInsert)[] = [];
  subs.forEach((s, i) => {
    const type = config.submissionTypes.find((t) => t.key === s.typeKey);
    const pool = config.reviewPools.find((p) => p.key === type?.reviewPool);
    if (!type || !pool) return;
    const authorIds = new Set(s.team.map((t) => id(t.person)));
    const eligible = reviewers
      .filter((rv) => poolOf.get(id(rv)) === pool.key && !authorIds.has(id(rv)))
      .filter((rv) => ![...authorIds].some((a) => conflictPairs.has(`${id(rv)}:${a}`)))
      .map((rv) => ({ rv, tiebreak: r.next() }))
      .sort(
        (a, b) => (load.get(id(a.rv)) ?? 0) - (load.get(id(b.rv)) ?? 0) || a.tiebreak - b.tiebreak,
      );
    for (const { rv } of eligible.slice(0, pool.reviewsPerSubmission)) {
      load.set(id(rv), (load.get(id(rv)) ?? 0) + 1);
      assignmentRows.push({
        conferenceId: conf.id,
        reviewerId: id(rv),
        submissionId: subIds[i] as string,
      });
    }
  });
  await db.insert(assignments).values(assignmentRows);

  return {
    conferenceId: conf.id,
    slug,
    adminEmail: admin.email,
    chairEmail: chair.email,
    trackChairEmails: trackChairs.map((t) => t.email),
    reviewerEmails: reviewers.map((rv) => rv.email),
    submissionCount: subIds.length,
    assignmentCount: assignmentRows.length,
    overCapPersonIds: overCap.map(id).sort(),
  };
}
