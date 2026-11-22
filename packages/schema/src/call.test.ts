import { describe, expect, it } from "vitest";
import { callState, isCallOpen } from "./call";
import { CONFERENCE_PHASES } from "./phases";

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

describe("callState", () => {
  const before = new Date("2027-01-11T04:59:59Z");
  const opening = new Date("2027-01-11T05:00:00Z");
  const during = new Date("2027-02-01T12:00:00Z");
  const lastMoment = new Date("2027-03-02T04:58:59Z");
  const closing = new Date("2027-03-02T04:59:00Z");
  const after = new Date("2027-06-01T00:00:00Z");

  it("is upcoming until the opening date, open inside the window, and closed from the deadline", () => {
    expect(callState(config, "cfp_open", before)).toBe("upcoming");
    expect(callState(config, "cfp_open", opening)).toBe("open");
    expect(callState(config, "cfp_open", during)).toBe("open");
    expect(callState(config, "cfp_open", lastMoment)).toBe("open");
    expect(callState(config, "cfp_open", closing)).toBe("closed");
    expect(callState(config, "cfp_open", after)).toBe("closed");
  });

  it("is open exactly when isCallOpen says so, in every phase", () => {
    for (const phase of CONFERENCE_PHASES) {
      for (const now of [before, opening, during, lastMoment, closing, after]) {
        expect(callState(config, phase, now) === "open", `${phase} ${now.toISOString()}`).toBe(
          isCallOpen(config, phase, now),
        );
      }
    }
  });

  it("a draft has not opened yet, whatever its opening date, until its closing date has passed", () => {
    expect(callState(config, "draft", before)).toBe("upcoming");
    // Inside the window nobody can submit to a draft: it opens when its chairs open it.
    expect(callState(config, "draft", during)).toBe("upcoming");
    expect(callState(config, "draft", closing)).toBe("closed");
  });

  it("is closed in every later phase, even inside the window", () => {
    for (const phase of CONFERENCE_PHASES.slice(2)) {
      for (const now of [before, during, after]) {
        expect(callState(config, phase, now), phase).toBe("closed");
      }
    }
  });

  it("counts a phase that is not one as closed", () => {
    expect(callState(config, "open", during)).toBe("closed");
    expect(callState(config, "", before)).toBe("closed");
  });
});
