import { describe, expect, it } from "vitest";
import { isCallOpen } from "./call";

const config = {
  deadlines: {
    submissionsOpen: "2027-01-11T00:00:00-05:00",
    submissionsClose: "2027-03-01T23:59:00-05:00",
    notification: "2027-04-30T23:59:00-05:00",
    finalMaterials: "2027-05-31T23:59:00-05:00",
  },
};

describe("isCallOpen", () => {
  it("needs both the cfp_open phase and the window", () => {
    expect(isCallOpen(config, "cfp_open", new Date("2027-02-01T12:00:00Z"))).toBe(true);
    expect(isCallOpen(config, "draft", new Date("2027-02-01T12:00:00Z"))).toBe(false);
    expect(isCallOpen(config, "cfp_open", new Date("2027-01-11T04:59:59Z"))).toBe(false);
    expect(isCallOpen(config, "cfp_open", new Date("2027-01-11T05:00:00Z"))).toBe(true);
  });

  it("closes exactly at the deadline", () => {
    expect(isCallOpen(config, "cfp_open", new Date("2027-03-02T04:58:59Z"))).toBe(true);
    expect(isCallOpen(config, "cfp_open", new Date("2027-03-02T04:59:00Z"))).toBe(false);
  });
});
