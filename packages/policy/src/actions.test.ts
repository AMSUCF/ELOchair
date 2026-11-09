import type { Contribution, Submission } from "@elochair/schema";
import { describe, expect, it } from "vitest";
import { canActOnSubmission, type SubmissionAction } from "./actions";
import type { AgentViewer, PersonViewer } from "./viewer";

const person = (personId: string, grants: PersonViewer["grants"] = []): PersonViewer => ({
  kind: "person",
  personId,
  siteAdmin: false,
  grants,
});
const c = (personId: string, role: Contribution["role"], status: Contribution["status"]) => ({
  personId,
  role,
  status,
});
// The owner moderates; the lead is a confirmed co-author: edit rights follow ownership, not role.
const contributions = [
  c("owner", "moderator", "confirmed"),
  c("lead", "lead", "confirmed"),
  c("inv", "coauthor", "invited"),
  c("gone", "presenter", "declined"),
];
const ACTIONS: SubmissionAction[] = [
  "edit",
  "manage_contributors",
  "submit",
  "unsubmit",
  "withdraw",
  "delete_draft",
  "answer_invitation",
  "leave",
];
const allowed = (
  viewer: Parameters<typeof canActOnSubmission>[0],
  status: Submission["status"] = "draft",
) =>
  ACTIONS.filter((a) =>
    canActOnSubmission(
      viewer,
      { submission: { status, ownerPersonId: "owner" }, contributions },
      a,
    ),
  );

describe("canActOnSubmission", () => {
  it("the owner manages a draft, whatever their program role", () => {
    expect(allowed(person("owner"))).toEqual([
      "edit",
      "manage_contributors",
      "submit",
      "delete_draft",
    ]);
  });

  it("the owner of submitted work can edit, return it to draft, or withdraw it", () => {
    expect(allowed(person("owner"), "submitted")).toEqual([
      "edit",
      "manage_contributors",
      "unsubmit",
      "withdraw",
    ]);
  });

  it("the lead (not owner) can only leave; an invitee can only answer; a declined person nothing", () => {
    expect(allowed(person("lead"))).toEqual(["leave"]);
    expect(allowed(person("inv"))).toEqual(["answer_invitation"]);
    expect(allowed(person("gone"))).toEqual([]);
  });

  it("declining and leaving stay possible after submission and even after decisions", () => {
    expect(allowed(person("inv"), "accepted")).toEqual(["answer_invitation"]);
    expect(allowed(person("lead"), "rejected")).toEqual(["leave"]);
  });

  it("withdrawn work is closed to its owner, but invitees can still decline and co-authors leave", () => {
    expect(allowed(person("owner"), "withdrawn")).toEqual([]);
    expect(allowed(person("lead"), "withdrawn")).toEqual(["leave"]);
    expect(allowed(person("inv"), "withdrawn")).toEqual(["answer_invitation"]);
    expect(allowed(person("gone"), "withdrawn")).toEqual([]);
  });

  it("chairs, strangers and agents (even the owner's) cannot change someone's submission", () => {
    const chair = person("chair", [{ conferenceId: "k", role: "chair", scope: [] }]);
    const agent: AgentViewer = {
      kind: "agent",
      tokenId: "t",
      tier: "C",
      conferenceId: "k",
      owner: person("owner"),
    };
    expect(allowed(chair)).toEqual([]);
    expect(allowed(person("stranger"))).toEqual([]);
    expect(allowed(agent)).toEqual([]);
    expect(allowed({ kind: "public" })).toEqual([]);
  });
});
