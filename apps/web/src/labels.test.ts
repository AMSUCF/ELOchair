import { CONFERENCE_PHASES } from "@elochair/schema/pure";
import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { callStateKey, chipKey, chipTone, phaseKey, phaseTone } from "./labels";

describe("what a conference's chip says", () => {
  it("says the call is open only while the server says it is", () => {
    expect(en[chipKey({ phase: "cfp_open", callState: "open" })]).toBe("Call for proposals open");
    // The phase is "call for proposals open" from the day the chairs open it, whatever the
    // dates say: before the opening date and after the closing date the chip says so.
    expect(en[chipKey({ phase: "cfp_open", callState: "upcoming" })]).toBe("Call opening soon");
    expect(en[chipKey({ phase: "cfp_open", callState: "closed" })]).toBe("Submissions closed");
  });

  it("is the phase's name in every other phase, as before", () => {
    for (const phase of CONFERENCE_PHASES) {
      if (phase === "cfp_open") continue;
      for (const callState of ["upcoming", "closed"] as const) {
        expect(chipKey({ phase, callState }), phase).toBe(phaseKey(phase));
        expect(chipTone({ phase, callState }), phase).toBe(phaseTone(phase));
      }
    }
    expect(en[chipKey({ phase: "draft", callState: "upcoming" })]).toBe("Draft");
    expect(en[chipKey({ phase: "reviewing", callState: "closed" })]).toBe("In review");
    expect(en[chipKey({ phase: "archived", callState: "closed" })]).toBe("Archived");
  });

  it("is green only for an open call", () => {
    expect(chipTone({ phase: "cfp_open", callState: "open" })).toBe("good");
    expect(chipTone({ phase: "cfp_open", callState: "upcoming" })).toBe("info");
    expect(chipTone({ phase: "cfp_open", callState: "closed" })).toBe("quiet");
  });

  it("names the three states of a call as the invitation does", () => {
    expect(en[callStateKey("open")]).toBe("Call for proposals");
    expect(en[callStateKey("upcoming")]).toBe("Call opening soon");
    expect(en[callStateKey("closed")]).toBe("Submissions closed");
  });
});
