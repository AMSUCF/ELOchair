import type { Contribution } from "@elochair/schema";
import { describe, expect, it } from "vitest";
import { canActOnSubmission, type SubmissionAction } from "./actions";
import type { AgentViewer, PersonViewer } from "./viewer";

const person = (personId: string, grants: PersonViewer["grants"] = []): PersonViewer => ({
  kind: "person",
  personId,
  siteAdmin: false,
  grants,
});
const contributions: Contribution[] = [
  { submissionId: "s", personId: "lead", role: "lead", position: 0, status: "confirmed" },
  { submissionId: "s", personId: "co", role: "presenter", position: 1, status: "confirmed" },
  { submissionId: "s", personId: "inv", role: "coauthor", position: 2, status: "invited" },
];
const ACTIONS: SubmissionAction[] = [
  "edit",
  "manage_contributors",
  "submit",
  "withdraw",
  "answer_invitation",
];
const allowed = (viewer: Parameters<typeof canActOnSubmission>[0], status = "draft" as const) =>
  ACTIONS.filter((a) => canActOnSubmission(viewer, { submission: { status }, contributions }, a));

describe("canActOnSubmission", () => {
  it("the lead edits, manages co-authors, submits and withdraws", () => {
    expect(allowed(person("lead"))).toEqual(["edit", "manage_contributors", "submit", "withdraw"]);
  });

  it("a confirmed co-author can do nothing but read", () => {
    expect(allowed(person("co"))).toEqual([]);
  });

  it("an invitee can only answer the invitation", () => {
    expect(allowed(person("inv"))).toEqual(["answer_invitation"]);
  });

  it("chairs, reviewers, strangers and agents cannot change someone's submission", () => {
    const chair = person("chair", [{ conferenceId: "k", role: "chair", scope: [] }]);
    const agent: AgentViewer = {
      kind: "agent",
      tokenId: "t",
      tier: "C",
      conferenceId: "k",
      owner: person("lead"),
    };
    expect(allowed(chair)).toEqual([]);
    expect(allowed(person("stranger"))).toEqual([]);
    expect(allowed(agent)).toEqual([]);
    expect(allowed({ kind: "public" })).toEqual([]);
  });

  it("submitted work stays editable but cannot be submitted again; withdrawn work is closed", () => {
    expect(allowed(person("lead"), "submitted" as never)).toEqual([
      "edit",
      "manage_contributors",
      "withdraw",
    ]);
    expect(allowed(person("lead"), "withdrawn" as never)).toEqual([]);
    expect(allowed(person("inv"), "accepted" as never)).toEqual([]);
  });
});
