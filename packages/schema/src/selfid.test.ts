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
