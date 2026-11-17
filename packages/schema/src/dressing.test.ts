import { describe, expect, it } from "vitest";
import { dressedAs } from "./dressing";

describe("dressedAs", () => {
  it("names ELO 2027's identity", () => {
    expect(dressedAs("elo2027")).toBe("elo2027");
  });

  it("also dresses the elo2027-open e2e/dev fixture (fixtures.ts's seedOpenCall clones elo2027 under this slug)", () => {
    expect(dressedAs("elo2027-open")).toBe("elo2027");
  });

  it("is undefined for conferences with no distinct identity, including unknown slugs", () => {
    expect(dressedAs("elo2026")).toBeUndefined();
    expect(dressedAs("nope")).toBeUndefined();
  });
});
