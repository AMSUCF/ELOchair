import { describe, expect, it } from "vitest";
import { ConferencePhase, isForwardPhaseMove } from "./config";
import {
  CONFERENCE_PHASES,
  canWithdrawIn,
  decisionsCanBeRecorded,
  decisionsCanBeSent,
  nextPhase,
  previousPhase,
  reviewersCanRead,
} from "./phases";

describe("the order of the phases", () => {
  it("is the schema's own: the enum is made from the list", () => {
    expect(ConferencePhase.options).toEqual([...CONFERENCE_PHASES]);
    expect(CONFERENCE_PHASES).toEqual([
      "draft",
      "cfp_open",
      "reviewing",
      "deciding",
      "confirming",
      "scheduling",
      "published",
      "archived",
    ]);
  });

  it("is walked one phase at a time, forward and back, and ends at both ends", () => {
    const forward: string[] = [];
    for (let p: string | null = "draft"; p; p = nextPhase(p)) forward.push(p);
    expect(forward).toEqual([...CONFERENCE_PHASES]);
    const back: string[] = [];
    for (let p: string | null = "archived"; p; p = previousPhase(p)) back.push(p);
    expect(back).toEqual([...CONFERENCE_PHASES].reverse());
    expect(nextPhase("archived")).toBeNull();
    expect(previousPhase("draft")).toBeNull();
    // A phase that is not one has nothing before or after it.
    expect(nextPhase("nonsense")).toBeNull();
    expect(previousPhase("")).toBeNull();
  });

  it("lets a submitted proposal be withdrawn until participants are being confirmed", () => {
    expect(CONFERENCE_PHASES.filter(canWithdrawIn)).toEqual(["cfp_open", "reviewing", "deciding"]);
    expect(canWithdrawIn("nonsense")).toBe(false);
  });

  it("lets reviewers read their assignments from the phase of review on", () => {
    expect(CONFERENCE_PHASES.filter(reviewersCanRead)).toEqual([
      "reviewing",
      "deciding",
      "confirming",
      "scheduling",
      "published",
      "archived",
    ]);
    for (const not of ["nonsense", "", "Reviewing"]) expect(reviewersCanRead(not), not).toBe(false);
  });

  it("lets decisions be recorded from the phase of review on, and sent once it has ended", () => {
    // Recorded while the reviews they rest on are written, and in every phase after.
    expect(CONFERENCE_PHASES.filter(decisionsCanBeRecorded)).toEqual(
      CONFERENCE_PHASES.filter(reviewersCanRead),
    );
    // Sent once reviewing has ended: what the authors are sent of the reviews is final then.
    expect(CONFERENCE_PHASES.filter(decisionsCanBeSent)).toEqual([
      "deciding",
      "confirming",
      "scheduling",
      "published",
      "archived",
    ]);
    for (const not of ["nonsense", "", "Deciding"]) {
      expect(decisionsCanBeRecorded(not), not).toBe(false);
      expect(decisionsCanBeSent(not), not).toBe(false);
    }
    // A proposal under consideration can still be withdrawn while decisions are sent.
    expect(CONFERENCE_PHASES.filter((p) => canWithdrawIn(p) && decisionsCanBeSent(p))).toEqual([
      "deciding",
    ]);
  });

  it("steps forward by a move that needs no force, and back by one that does", () => {
    for (const phase of CONFERENCE_PHASES) {
      const next = nextPhase(phase);
      if (next) expect(isForwardPhaseMove(phase, next), `${phase} → ${next}`).toBe(true);
      const previous = previousPhase(phase);
      // draft ⇄ cfp_open is the one step back the rule lets through without a reason.
      if (previous) {
        expect(isForwardPhaseMove(phase, previous), `${phase} → ${previous}`).toBe(
          phase === "cfp_open",
        );
      }
    }
  });
});
