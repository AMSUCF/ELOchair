import { describe, expect, it } from "vitest";
import { DECISION_OUTCOMES, decisionOutcomesFor } from "./decisions";
import { Decision, SubmissionStatus } from "./domain";
import { DecisionInput, SendDecisionsInput } from "./inputs";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("a decision", () => {
  it("is one of three outcomes, each the status it gives a proposal when it is sent", () => {
    expect(DECISION_OUTCOMES).toEqual(["accepted", "waitlisted", "rejected"]);
    for (const outcome of DECISION_OUTCOMES) {
      expect(SubmissionStatus.options).toContain(outcome);
    }
  });

  it("can be recorded for a proposal under consideration, and for one on the waiting list the two that end it", () => {
    const takes = Object.fromEntries(
      SubmissionStatus.options.map((status) => [status, decisionOutcomesFor(status)]),
    );
    expect(takes).toEqual({
      draft: [],
      submitted: ["accepted", "waitlisted", "rejected"],
      withdrawn: [],
      // A sent accept or reject is final in the app, and so is what follows an accept.
      accepted: [],
      waitlisted: ["accepted", "rejected"],
      rejected: [],
      confirmed: [],
      published: [],
    });
    expect(decisionOutcomesFor("nonsense")).toEqual([]);
  });

  it("is kept with what was sent with it, once it is sent", () => {
    const waiting = {
      id: id(1),
      conferenceId: id(2),
      submissionId: id(3),
      outcome: "waitlisted",
      decidedByPersonId: id(4),
      decidedAt: "2027-04-01T10:00:00.000Z",
      sentAt: null,
      sentByPersonId: null,
      comments: null,
    };
    expect(Decision.parse(waiting)).toEqual(waiting);
    const sent = {
      ...waiting,
      sentAt: "2027-04-02T10:00:00.000Z",
      sentByPersonId: id(5),
      comments: ["A comment for the authors.", "Another."],
    };
    expect(Decision.parse(sent)).toEqual(sent);
    // One made on the server names no chair.
    expect(Decision.safeParse({ ...waiting, decidedByPersonId: null }).success).toBe(true);
    for (const bad of [
      { ...waiting, outcome: "accept" },
      { ...waiting, outcome: "confirmed" },
      { ...waiting, submissionId: "not-an-id" },
      { ...sent, comments: [1, 2] },
    ]) {
      expect(Decision.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("what a chair sends to record and to send decisions", () => {
  it("recording names an outcome, and nothing else", () => {
    for (const outcome of DECISION_OUTCOMES) {
      expect(DecisionInput.parse({ outcome })).toEqual({ outcome });
    }
    for (const bad of [
      {},
      { outcome: "accept" },
      { outcome: "submitted" },
      { outcome: null },
      { outcome: ["accepted"] },
      // Nothing in the request can name the proposal, who decides, or that it is sent.
      { outcome: "accepted", submissionId: id(1) },
      { outcome: "accepted", decidedByPersonId: id(2) },
      { outcome: "accepted", sentAt: "2027-04-02T10:00:00.000Z" },
      { outcome: "accepted", comments: [] },
    ]) {
      expect(DecisionInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("sending names the confirmation it was shown, and nothing else", () => {
    const token = "0123456789abcdef0123456789abcdef";
    expect(SendDecisionsInput.parse({ token })).toEqual({ token });
    for (const bad of [
      {},
      { token: "" },
      { token: token.slice(1) },
      { token: `${token}0` },
      { token: token.toUpperCase() },
      { token, force: true },
      { token, submissionIds: [id(1)] },
      { token, outcome: "accepted" },
    ]) {
      expect(SendDecisionsInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
