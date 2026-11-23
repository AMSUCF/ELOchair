import { type ConferenceConfig, type ConferenceConfigInput, conferences } from "@elochair/schema";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  assignments,
  conflicts,
  contributions,
  notificationChoices,
  people,
  reviewerProfiles,
  submissions,
} from "./db/schema";
import { fixtureCall } from "./fixture-call";
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

/**
 * Made-up guidelines for the sandbox's artistic pool, so that the text a chair writes for
 * reviewers (spec 02, §1.9) can be seen in development and in the browser tests: in three
 * languages, with line breaks. The other pool has none.
 */
const SANDBOX_GUIDELINES = {
  pool: "artistic",
  text: {
    en: "These guidelines are made up for the sandbox.\n\nRead the whole proposal before you judge it. Judge the work that is described, not how well it is written about.\n\nIf you have a conflict of interest with a proposal, tell the chairs instead of reviewing it.",
    es: "Estas pautas son inventadas para el entorno de pruebas.\n\nLee toda la propuesta antes de valorarla. Valora la obra que se describe, no lo bien que está redactada.\n\nSi tienes un conflicto de interés con una propuesta, avisa a la presidencia en lugar de revisarla.",
    pt: "Estas orientações são inventadas para o ambiente de testes.\n\nLeia a proposta inteira antes de a avaliar. Avalie a obra que é descrita, e não a qualidade da redação.\n\nSe tiver um conflito de interesses com uma proposta, avise a presidência em vez de a rever.",
  },
} as const;

/**
 * Made up for the sandbox too, so that what the chairs set for the review form (spec 03, §1.8)
 * can be seen in development and in the browser tests: what one criterion of the artistic pool
 * asks, in three languages; the fewest words its comments for the authors may have; and the
 * day reviews are due, between the day the 2026 call closed and the day its decisions were
 * sent. That day is long past: it is shown, and locks nothing.
 */
const SANDBOX_FORM = {
  pool: "artistic",
  criterion: "merit",
  description: {
    en: "1 is a work that does not hold together yet; 5 is one you would send a friend to see.",
    es: "1 es una obra que todavía no se sostiene; 5 es una a la que mandarías a una amistad.",
    pt: "1 é uma obra que ainda não se sustenta; 5 é uma a que mandaria uma pessoa amiga.",
  },
  commentsMinWords: 10,
  reviewsDue: "2026-03-31T23:59:00-04:00",
} as const;

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
  const base = structuredClone(conferences.elo2026);
  const conf = await saveConference(
    db,
    {
      ...base,
      slug,
      title: { en: "Sandbox: synthetic ELO 2026-shaped data" },
      placeholder: true,
      deadlines: { ...base.deadlines, reviewsDue: SANDBOX_FORM.reviewsDue },
      reviewPools: base.reviewPools.map((pool) =>
        pool.key === SANDBOX_GUIDELINES.pool
          ? {
              ...pool,
              guidelines: { ...SANDBOX_GUIDELINES.text },
              criteria: pool.criteria.map((criterion) =>
                criterion.key === SANDBOX_FORM.criterion
                  ? { ...criterion, description: { ...SANDBOX_FORM.description } }
                  : criterion,
              ),
              form: { comments: { minWords: SANDBOX_FORM.commentsMinWords } },
            }
          : pool,
      ),
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
    bios: Record<string, string>;
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
      bios: { en: `${first} ${last} is a fictional participant generated for testing ELOchair.` },
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
      const nWords = r.int(type.abstract.minWords ?? 1, type.abstract.maxWords);
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
        ownerPersonId: id(team[0]?.person as P),
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant `ms`, written in the offset that `like` is written in. A seeded call then states
 * each deadline on the clock its configuration does (anywhere on Earth for the closing date of
 * the two calls here, the conference's own for the others), which is how the pages show it.
 */
function writtenLike(ms: number, like: string): string {
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(like);
  if (!offset) return new Date(ms).toISOString();
  const minutes = (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]));
  return new Date(ms + minutes * 60_000).toISOString().replace("Z", offset[0]);
}

/**
 * A call that is open relative to `now`: opened yesterday, closing in 30 days, phase cfp_open.
 * Its deadlines are those instants, each in the offset the base configuration wrote it in.
 */
async function seedCall(
  db: Db,
  base: ConferenceConfigInput,
  opts: { slug: string; now: Date; chairEmails?: string[] },
): Promise<{ conferenceId: string; slug: string }> {
  const { slug } = opts;
  const t = opts.now.getTime();
  // The four every call states. (The day reviews are due is the chairs' to set, and optional.)
  const at = (
    ms: number,
    deadline: Exclude<keyof ConferenceConfigInput["deadlines"], "reviewsDue">,
  ) => writtenLike(ms, base.deadlines[deadline]);
  const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const conf = await saveConference(
    db,
    {
      ...structuredClone(base),
      slug,
      placeholder: true,
      deadlines: {
        submissionsOpen: at(t - DAY_MS, "submissionsOpen"),
        submissionsClose: at(t + 30 * DAY_MS, "submissionsClose"),
        notification: at(t + 60 * DAY_MS, "notification"),
        finalMaterials: at(t + 90 * DAY_MS, "finalMaterials"),
      },
      dates: { start: date(t + 120 * DAY_MS), end: date(t + 123 * DAY_MS) },
    },
    "cfp_open",
  );
  for (const email of opts.chairEmails ?? []) {
    const [p] = await db.select({ id: people.id }).from(people).where(eq(people.email, email));
    if (p)
      await grantRole(db, {
        conferenceId: conf.id,
        personId: p.id,
        role: email.startsWith("admin") ? "admin" : "chair",
      });
  }
  return { conferenceId: conf.id, slug };
}

/**
 * ELO 2027's own configuration as an open call, for development and the end-to-end tests: what
 * people will really be offered, on dates that follow the clock, so it works whatever day it is.
 */
export function seedOpenCall(
  db: Db,
  opts: { slug?: string; now: Date; chairEmails?: string[] },
): Promise<{ conferenceId: string; slug: string }> {
  return seedCall(
    db,
    {
      ...conferences.elo2027,
      title: {
        en: "ELO 2027 (open test call)",
        es: "ELO 2027 (convocatoria de prueba)",
        pt: "ELO 2027 (chamada de teste)",
      },
    },
    { ...opts, slug: opts.slug ?? "elo2027-open" },
  );
}

/**
 * A conference in review with nothing in it, whose phase is there to be moved: in development,
 * and by the browser test of the phase control. Reviews are written only while a conference is
 * in `reviewing` (spec 03, §1.4), so the sandbox, where reviewers work, has to stay there:
 * nothing moves it, and whatever needs a phase to move moves this one.
 */
export async function seedPhaseRoom(
  db: Db,
  opts: { slug?: string; chairEmails?: string[] } = {},
): Promise<{ conferenceId: string; slug: string }> {
  const slug = opts.slug ?? "phase-room";
  const conf = await saveConference(
    db,
    {
      ...structuredClone(fixtureCall),
      slug,
      placeholder: true,
      title: {
        en: "Phase room: an empty conference for trying the phase control",
        es: "Sala de fases: un congreso vacío para probar el control de fases",
        pt: "Sala de fases: um congresso vazio para experimentar o controlo de fases",
      },
    },
    "reviewing",
  );
  for (const email of opts.chairEmails ?? []) {
    const [p] = await db.select({ id: people.id }).from(people).where(eq(people.email, email));
    if (p) await grantRole(db, { conferenceId: conf.id, personId: p.id, role: "chair" });
  }
  return { conferenceId: conf.id, slug };
}

/**
 * A small conference in review whose chair also reviews: three talks by a fictional author,
 * each assigned to the chair, who holds the reviewer's role for the committee that reviews
 * talks. In development, and for the browser test of a chair's own review (a chair reads a
 * proposal as a chair and reviews it like anyone: spec 03, §1.4), which writes to nothing that
 * another test reads. Nothing is seeded where the chair's address is not a person yet. A second
 * reviewer of that committee is there to be assigned: they chose an email for each one.
 */
export async function seedChairReviews(
  db: Db,
  opts: { slug?: string; chairEmail: string },
): Promise<{ conferenceId: string; slug: string }> {
  const slug = opts.slug ?? "chair-reviews";
  const conf = await saveConference(
    db,
    {
      ...structuredClone(fixtureCall),
      slug,
      placeholder: true,
      title: {
        en: "Chair reviews: a small conference whose chair also reviews",
        es: "La presidencia revisa: un congreso pequeño cuya presidencia también revisa",
        pt: "A presidência revê: um congresso pequeno cuja presidência também revê",
      },
    },
    "reviewing",
  );
  const [chair] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.email, opts.chairEmail));
  const type = fixtureCall.submissionTypes.find((t) => t.key === "talk");
  if (!chair || !type) return { conferenceId: conf.id, slug };
  const pool = type.reviewPool;
  await grantRole(db, { conferenceId: conf.id, personId: chair.id, role: "chair" });
  await grantRole(db, {
    conferenceId: conf.id,
    personId: chair.id,
    role: "reviewer",
    scope: [pool],
  });
  await db
    .insert(reviewerProfiles)
    .values({ conferenceId: conf.id, personId: chair.id, pools: [pool], languages: ["en"] });
  const [author] = await db
    .insert(people)
    .values({
      email: `${slug}-author@example.org`,
      displayName: "Fictional Author",
      affiliation: "Institute of Imaginary Letters",
      languages: ["en"],
      bios: {},
    })
    .returning({ id: people.id });
  if (!author) return { conferenceId: conf.id, slug };
  const abstract = Array.from(
    { length: type.abstract.minWords ?? 50 },
    (_, i) => ["a", "talk", "made", "up", "for", "testing"][i % 6],
  ).join(" ");
  const made = await db
    .insert(submissions)
    .values(
      ["One", "Two", "Three"].map((n) => ({
        conferenceId: conf.id,
        ownerPersonId: author.id,
        typeKey: type.key,
        language: "en",
        title: `Fictional talk ${n}, for a chair who reviews`,
        abstract,
        participationMode: "in_person",
        status: "submitted",
        submittedAt: new Date(Date.UTC(2026, 1, 10)),
      })),
    )
    .returning({ id: submissions.id });
  await db
    .insert(contributions)
    .values(
      made.map((s) => ({ submissionId: s.id, personId: author.id, role: "lead", position: 0 })),
    );
  await db
    .insert(assignments)
    .values(made.map((s) => ({ conferenceId: conf.id, reviewerId: chair.id, submissionId: s.id })));
  // A second reviewer of that committee, who has nothing assigned and has asked for an email
  // for each new assignment (spec 03, §1.7): in development, and for the browser test that
  // assigns them a talk and reads the email it makes. Nobody signs in as them.
  const [second] = await db
    .insert(people)
    .values({
      email: `${slug}-reviewer@example.org`,
      displayName: "Fictional Reviewer",
      affiliation: "Institute of Imaginary Letters",
      languages: ["en"],
      bios: {},
    })
    .returning({ id: people.id });
  if (!second) return { conferenceId: conf.id, slug };
  await grantRole(db, {
    conferenceId: conf.id,
    personId: second.id,
    role: "reviewer",
    scope: [pool],
  });
  await db
    .insert(reviewerProfiles)
    .values({ conferenceId: conf.id, personId: second.id, pools: [pool], languages: ["en"] });
  await db
    .insert(notificationChoices)
    .values({ personId: second.id, conferenceId: conf.id, assignments: "each" });
  return { conferenceId: conf.id, slug };
}

/**
 * The fixture call (fixture-call.ts) as an open call, for server tests: formats and limits that
 * do not change when a real conference's configuration does.
 */
export function seedTestCall(
  db: Db,
  opts: { slug?: string; now: Date; chairEmails?: string[] },
): Promise<{ conferenceId: string; slug: string }> {
  return seedCall(db, fixtureCall, { ...opts, slug: opts.slug ?? fixtureCall.slug });
}

export { fixtureCall };
