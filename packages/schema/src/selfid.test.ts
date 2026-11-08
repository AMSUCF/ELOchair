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
    expect(kinds("See www.anaperez-poetry.net or https://example.org/perez/works")).toEqual([
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
