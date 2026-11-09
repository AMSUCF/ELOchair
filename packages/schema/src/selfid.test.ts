import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type IdentityHint, selfIdentificationWarnings } from "./selfid";

const ana = {
  displayName: "Ana Lucía Pérez",
  affiliation: "Universidad Imaginaria del Caribe",
  email: "aperez@imaginaria.edu.co",
  orcid: "0000-0002-1825-0097",
};
const kinds = (text: string, people: IdentityHint[] = [ana]) =>
  selfIdentificationWarnings([{ path: "abstract", text }], people).map((w) => w.kind);

describe("selfIdentificationWarnings", () => {
  it("finds a full name regardless of case and accents", () => {
    expect(kinds("As ANA LUCIA PEREZ argued before…")).toEqual(["name"]);
  });

  it("finds self-citations by surname", () => {
    expect(kinds("Building on earlier work (Pérez 2021), we …")).toEqual(["citation"]);
    expect(kinds("As Perez (2019) shows …")).toEqual(["citation"]);
    expect(kinds("(Smith and Pérez, eds., 2020)")).toEqual(["citation"]);
  });

  it("does not flag the surname as an ordinary word without a year", () => {
    expect(kinds("Pérez is a common surname in this corpus.")).toEqual([]);
  });

  it("finds affiliations, but not generic ones", () => {
    expect(kinds("At the Universidad Imaginaria del Caribe lab, we…")).toEqual(["affiliation"]);
    const indie = { ...ana, affiliation: "Independent artist" };
    expect(kinds("An independent artist made this.", [indie])).toEqual([]);
  });

  it("finds emails, ORCID iDs, and links on the author's own domain or with their name", () => {
    expect(kinds("Contact aperez@imaginaria.edu.co")).toEqual(["email"]);
    expect(kinds("ORCID 0000 0002 1825 0097")).toEqual(["orcid"]);
    expect(kinds("See https://lab.imaginaria.edu.co/works/1")).toEqual(["url"]);
    expect(kinds("See www.perez-poetry.net or https://example.org/perez/works")).toEqual([
      "url",
      "url",
    ]);
  });

  it("ignores links on generic mail domains and unrelated sites", () => {
    const gmail = { ...ana, email: "ana@gmail.com" };
    expect(
      kinds("Built with https://twinery.org and hosted at https://gmail.com/x", [gmail]),
    ).toEqual([]);
  });

  it("reports each finding once per path and checks every given path", () => {
    const w = selfIdentificationWarnings(
      [
        { path: "title", text: "Ana Lucía Pérez, again: Ana Lucía Pérez" },
        { path: "fields.needs", text: "Nothing to see" },
      ],
      [ana],
    );
    expect(w).toEqual([{ path: "title", kind: "name", match: "Ana Lucía Pérez" }]);
  });

  it("does not match a name inside a longer word", () => {
    const bo = { displayName: "Bo Lin", affiliation: null, email: "b@x.org", orcid: null };
    expect(kinds("A bolin gear and Bo Lindqvist", [bo])).toEqual([]);
  });
});

describe("surnames in Spanish and Portuguese names", () => {
  const maria = {
    displayName: "María José Rodríguez Vera",
    affiliation: null,
    email: "m@gmail.com",
    orcid: null,
  };
  const anaPaula = {
    displayName: "Ana Paula da Silva Santos",
    affiliation: null,
    email: "a@gmail.com",
    orcid: null,
  };
  const k = (text: string, p: IdentityHint) =>
    selfIdentificationWarnings([{ path: "a", text }], [p]).map((w) => w.match);

  it("finds citations of either family name and skips particles", () => {
    expect(k("as shown (Rodríguez 2021)", maria)).toEqual(["rodriguez"]);
    expect(k("see Vera (2019)", maria)).toEqual(["vera"]);
    expect(k("(Silva 2020)", anaPaula)).toEqual(["silva"]);
    expect(k("(da 2020)", anaPaula)).toEqual([]);
  });

  it("matches surnames in links only as whole labels or path segments", () => {
    expect(k("https://www.veracruz.gob.mx/turismo", maria)).toEqual([]);
    const cruz = {
      displayName: "Juan de la Cruz",
      affiliation: null,
      email: "j@gmail.com",
      orcid: null,
    };
    expect(k("https://www.veracruz.gob.mx/turismo", cruz)).toEqual([]);
    expect(k("https://cruz.example.net/works", cruz)).toEqual(["cruz.example.net"]);
  });
});

describe("self-citations in the forms en/es/pt writing uses (review fixes)", () => {
  const joao = {
    displayName: "João Carlos Gonçalves",
    affiliation: null,
    email: "joao@gmail.com",
    orcid: null,
  };
  const person = (displayName: string): IdentityHint => ({
    displayName,
    affiliation: null,
    email: "someone@gmail.com",
    orcid: null,
  });
  const soren = person("Søren Østergaard");
  const jan = person("Jan Łukasiewicz");
  const sofia = person("Sofía Paz");
  const juan = person("Juan de la Cruz");
  const anaPaula = person("Ana Paula da Silva Santos");
  const found = (text: string, p: IdentityHint) =>
    selfIdentificationWarnings([{ path: "abstract", text }], [p]).map(
      (w) => `${w.kind}:${w.match}`,
    );

  it.each<[string, IdentityHint, string]>([
    ["As Pérez et al. (2021) argue, the hypertext…", ana, "citation:perez"],
    ["Pérez et al.'s (2021) corpus", ana, "citation:perez"],
    ["Como muestran Pérez y Gómez (2020), la poesía…", ana, "citation:perez"],
    ["Pérez and Smith (2020) showed…", ana, "citation:perez"],
    ["Pérez, Smith & Jones (2020)", ana, "citation:perez"],
    ["Pérez y de la Cruz (2020)", ana, "citation:perez"],
    ["Gonçalves e Silva (2018) mostram…", joao, "citation:goncalves"],
    ["Pérez's (2019) study of bots", ana, "citation:perez"],
    ["Pérez’s (2019) study of bots", ana, "citation:perez"],
    ["Gonçalves' (2018) argument", joao, "citation:goncalves"],
    ["Pérez [2019] shows…", ana, "citation:perez"],
    ["[Pérez 2019]", ana, "citation:perez"],
    ["Em trabalho anterior (Gonçalves, 2019), analisamos…", joao, "citation:goncalves"],
    ["Pérez, A. L. (2021). Bots y poesía. Revista X.", ana, "citation:perez"],
    ["Gómez, J., & Pérez, A. L. (2021). Bots.", ana, "citation:perez"],
    [
      "Referências: GONÇALVES, João Carlos. Poesia digital. São Paulo: Editora, 2020.",
      joao,
      "citation:goncalves",
    ],
    ["Works cited: Pérez, Ana Lucía. Bots y poesía. Editorial, 2021.", ana, "citation:perez"],
    ["Pérez, Ana Lucía. 2021. Bots y poesía.", ana, "citation:perez"],
    ["(Østergaard 2019) shows", soren, "citation:østergaard"],
    ["Østergaard (2019) shows", soren, "citation:østergaard"],
    ["(Łukasiewicz 2020)", jan, "citation:łukasiewicz"],
    ["Łukasiewicz (2020) proves", jan, "citation:łukasiewicz"],
    ["See www.anaperez.net/obras", ana, "url:www.anaperez.net"],
    ["See https://github.com/anaperez", ana, "url:github.com"],
    ["See https://mastodon.social/@analuciaperez", ana, "url:mastodon.social"],
    ["See https://perezana.example/works", ana, "url:perezana.example"],
    ["See https://juancruz.example", juan, "url:juancruz.example"],
    ["See https://joaocarlosgoncalves.com.br", joao, "url:joaocarlosgoncalves.com.br"],
  ])("finds %j", (text, p, expected) => {
    expect(found(text, p)).toContain(expected);
  });

  it.each<[string, IdentityHint]>([
    // Someone else's citation, in every form.
    ["As Gómez et al. (2021) argue", ana],
    ["Como muestran Gómez y Silva (2020)", ana],
    ["Gómez's (2019) study", ana],
    ["Gómez [2019]", ana],
    ["Gómez, A. L. (2021). Bots y poesía.", ana],
    ["SILVA, João Carlos. Poesia digital. São Paulo: Editora, 2020.", joao],
    // The same surname with another given name: someone else's reference entry.
    ["Pérez, Juan. Otro libro. Editorial, 2019.", ana],
    ["Pérez, J. (2019). Otro libro.", ana],
    // The surname in prose, not in a citation.
    ["Pérez, a common surname, appears in records from 2020.", ana],
    ["Pérez and the 2020 elections", ana],
    ["Pérez is a common surname; see Gómez (2020).", ana],
    ["I met Pérez, then read (Gómez 2020).", ana],
    // A surname that is also a common word, written as a word.
    ["Hablamos de la paz y Gómez (2020) lo confirma.", sofia],
    ["la paz (2020) fue firmada", sofia],
    // Particles are never surnames, even next to a year.
    ["Os dados da (2020) pesquisa e de (2019)", anaPaula],
    ["La (2020) edición y de (2019)", juan],
    ["Como en la edición y (2020)", juan],
    // A surname inside a longer word, or a link that only contains part of a name.
    ["Perezoso (2020) is a sloth", ana],
    ["See https://example.org/anaconda", ana],
    ["See https://www.veracruz.gob.mx/turismo", juan],
  ])("does not flag %j", (text, p) => {
    expect(found(text, p)).toEqual([]);
  });
});

describe("narrative co-authors, places and titles (second review, #9)", () => {
  const person = (displayName: string): IdentityHint => ({
    displayName,
    affiliation: null,
    email: "someone@gmail.com",
    orcid: null,
  });
  const citations = (text: string, name: string) =>
    selfIdentificationWarnings([{ path: "abstract", text }], [person(name)])
      .filter((w) => w.kind === "citation")
      .map((w) => w.match);

  it.each<[string, string, string]>([
    // A list of co-authors joined by commas counts when it ends with a conjunction or "et al.".
    ["Pérez, Gómez y Ruiz (2020) proponen…", "Ana Lucía Pérez", "perez"],
    ["Gómez, Pérez y Ruiz (2020) proponen…", "Ana Lucía Pérez", "perez"],
    ["Pérez, Gómez e Silva (2020) propõem…", "Ana Lucía Pérez", "perez"],
    ["Pérez, Smith, and Jones (2020) show…", "Ana Lucía Pérez", "perez"],
    ["Pérez, Gómez et al. (2020) show…", "Ana Lucía Pérez", "perez"],
    ["Pérez,\n   Smith,\n   and Jones\n   (2020)", "Ana Lucía Pérez", "perez"],
    // The person's own article before the surname is part of the name.
    ["La Rosa (2019) muestra…", "Ana La Rosa", "rosa"],
    ["De la Cruz (2020) muestra…", "Juan de la Cruz", "cruz"],
    ["Como en Gómez y de la Cruz (2020)…", "Juan de la Cruz", "cruz"],
    ["Le Guin (1969) wrote…", "Ursula K. Le Guin", "guin"],
    ["Paz (2019) shows…", "Sofía Paz", "paz"],
  ])("finds %j", (text, name, surname) => {
    expect(citations(text, name)).toEqual([surname]);
  });

  it.each<[string, string]>([
    // "City, Region (year)": a comma alone does not make a list of co-authors.
    ["El festival se celebró en La Paz, Bolivia (2019) y en Quito.", "Sofía Paz"],
    ["Residencias en Santa Cruz, Bolivia (2021).", "Ana Cruz"],
    ["El encuentro de León, Guanajuato (2019) reunió a poetas digitales.", "Juan León"],
    ["Mostra em Costa e Silva, MG (2020).", "Ana Costa"],
    ["Visto en Santos, São Paulo (2018).", "Maria Santos"],
    ["Pérez, Gómez (2020)", "Ana Lucía Pérez"],
    // An article before the surname makes it a place or a title, unless the name has it.
    ["La Cruz y la Espada (2018) es un juego narrativo.", "Juan Cruz"],
    ["Los Campos, Ríos y Montes (2020) de la obra exploran el paisaje.", "Pedro Campos"],
    ["Vivimos en La Paz (2019–2021).", "Sofía Paz"],
    ["Una lectura de Le Guin (1969).", "Ana Guin"],
  ])("does not flag %j", (text, name) => {
    expect(citations(text, name)).toEqual([]);
  });

  /*
   * These read exactly like real two- or three-author citations, so they stay flagged. Telling
   * "Santos e Recife (2019–2021)" from "Gonçalves e Silva (2018)" would take a list of places,
   * and places are exactly the surnames at issue (Santos, León, Paz). Ignoring year ranges would
   * miss authors citing their own long-running work. A firm named after the author identifies
   * them too. A needless warning costs the owner a glance; a missed one costs the anonymity of
   * the review.
   */
  it.each<[string, string, string, string]>([
    [
      "Exibida em Santos e Recife (2019–2021).",
      "Maria Santos",
      "Gonçalves e Silva (2018)",
      "João Silva",
    ],
    ["La exposición Rosa y Negro (2019).", "Ana Rosa", "Pérez y Gómez (2019).", "Ana Pérez"],
    ["Recorremos Tierra, Mar y Aire (2020).", "Luis Mar", "Gómez, Mar y Ruiz (2020).", "Luis Mar"],
    [
      "Vega, Altair and Deneb (2021) form a triangle.",
      "Ana Vega",
      "Vega, Smith and Jones (2021).",
      "Ana Vega",
    ],
    [
      "Silva & Associates (2020) designed it.",
      "Ana Silva",
      "Silva & Jones (2020) designed it.",
      "Ana Silva",
    ],
  ])("still flags %j (%s), which reads like %j", (place, name, real, realName) => {
    expect(citations(place, name)).toHaveLength(1);
    expect(citations(real, realName)).toHaveLength(1);
  });
});

describe("time taken on long and hostile text (second review, #7)", () => {
  /*
   * Each call takes a few milliseconds here. The budget leaves room for a slow CI machine; the
   * detector before this fix took over 600 ms on a surname followed by 10,000 spaces (the time
   * grew with the square of the run) and about a second on the generated abstract below.
   */
  const BUDGET_MS = 250;
  const NAMES = [
    "Ana Lucía Pérez Gómez",
    "João Carlos Gonçalves da Silva",
    "María José Rodríguez Vera",
    "Søren Østergaard",
    "Juan de la Cruz Ramírez",
    "Ana Paula dos Santos Lima",
    "Luis Alberto Mar Fuentes",
    "Sofía Paz Herrera",
    "Carlos Eduardo León Castillo",
    "Beatriz Rosa Navarro",
  ];
  const people: IdentityHint[] = NAMES.map((displayName, i) => ({
    displayName,
    affiliation: `Universidad Ficticia ${i}`,
    email: `p${i}@ficticia${i}.example`,
    orcid: null,
  }));
  const timed = (text: string) => {
    selfIdentificationWarnings([{ path: "warm-up", text: "Pérez (2020)" }], people);
    const t0 = performance.now();
    const found = selfIdentificationWarnings([{ path: "abstract", text }], people);
    return { ms: performance.now() - t0, found };
  };
  const NBSP = String.fromCharCode(0xa0);

  it.each<[string, string]>([
    ["10,000 spaces", `Pérez${" ".repeat(10_000)}x`],
    ["10,000 line breaks", `Pérez${"\n".repeat(10_000)}x`],
    ["10,000 tabs, spaces and no-break spaces", `Pérez${` \t${NBSP}`.repeat(3_334)}x`],
    ["10,000 '('", `Pérez${"(".repeat(10_000)}x`],
    ["10,000 ', ' pairs", `Pérez${", ".repeat(10_000)}x`],
    ["10,000 ' ,' pairs", `Pérez${" ,".repeat(10_000)}x`],
    ["10,000 apostrophes", `Pérez y Gómez${"'".repeat(10_000)}`],
    ["10,000 particles", `Pérez y ${"de ".repeat(10_000)}x`],
    ["3,000 co-authors", `Pérez${", Gómez".repeat(3_000)} (x)`],
    ["a reference entry and 10,000 spaces", `Pérez, Ana${" ".repeat(10_000)}x`],
  ])("a surname followed by %s", (_, text) => {
    expect(timed(text).ms).toBeLessThan(BUDGET_MS);
  });

  it("10,000 brackets before a surname, a surname 5,000 times, long links and digits", () => {
    expect(timed(`${"[".repeat(10_000)}Pérez`).ms).toBeLessThan(BUDGET_MS);
    expect(timed(`(${"Pérez ".repeat(5_000)}`).ms).toBeLessThan(BUDGET_MS);
    expect(timed("Pérez y Gómez (".repeat(5_000)).ms).toBeLessThan(BUDGET_MS);
    expect(timed("Pérez, Ana ".repeat(5_000)).ms).toBeLessThan(BUDGET_MS);
    expect(timed(`https://${"perez.".repeat(10_000)}x`).ms).toBeLessThan(BUDGET_MS);
    expect(timed("www.perez ".repeat(5_000)).ms).toBeLessThan(BUDGET_MS);
    const orcid = { ...ana, orcid: "0000-0002-1825-0097" };
    const t0 = performance.now();
    selfIdentificationWarnings([{ path: "abstract", text: "0".repeat(50_000) }], [orcid]);
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
  });

  it("a 50,000-character abstract full of candidate surnames, joins, years and blank runs", () => {
    // Deterministic (mulberry32), so a failure can be reproduced.
    let seed = 2027;
    const next = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };
    const surnames = NAMES.flatMap((n) => n.split(" ").slice(1));
    const words = ["la", "poesía", "y", "e", "and", "&", "et al.", ",", "the", "obra", "Smith"];
    // Runs like the ones text pasted from a PDF or a table leaves.
    const runs = [" ", "\n", "\t", " ,", "(", ", ", " \n"];
    const parts: string[] = [];
    for (let size = 0; size < 50_000; size += (parts.at(-1)?.length ?? 0) + 1) {
      const r = next(20);
      parts.push(
        r < 6
          ? (surnames[next(surnames.length)] as string)
          : r < 8
            ? `(${1990 + next(36)})`
            : r === 8
              ? (runs[next(runs.length)] as string).repeat(1 + next(4_000))
              : (words[next(words.length)] as string),
      );
    }
    const text = parts.join(" ").slice(0, 50_000);
    expect(text).toHaveLength(50_000);
    const { ms, found } = timed(text);
    expect(found.length).toBeGreaterThan(3);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("gives the same answer however long the runs of whitespace are", () => {
    const token = fc.constantFrom(
      "Pérez",
      "PÉREZ",
      "pérez",
      "Gómez",
      "Ana",
      "A.",
      "la",
      "La",
      "y",
      "and",
      "&",
      "et al.",
      ",",
      "'s",
      "(",
      ")",
      "[",
      "(2020)",
      "2021",
      "eds.",
      ".",
    );
    const gap = fc.constantFrom(" ", "\n", "", "\t");
    const run = (text: string) => selfIdentificationWarnings([{ path: "a", text }], [ana]);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(token, gap), { maxLength: 30 }),
        fc.integer({ min: 2, max: 50 }),
        (pairs, k) => {
          const text = pairs.map(([t, g]) => t + g).join("");
          const wide = pairs
            .map(([t, g]) => t + (g === "\n" ? `${" ".repeat(k)}\n\n` : g.repeat(k)))
            .join("");
          expect(run(wide)).toEqual(run(text));
        },
      ),
      { numRuns: 300 },
    );
  });
});
