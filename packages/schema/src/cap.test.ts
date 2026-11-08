import { describe, expect, it } from "vitest";
import { presenterCapReport } from "./cap";
import { elo2026 } from "./conferences";
import { ConferenceConfig } from "./config";
import type { Contribution } from "./domain";

const config = ConferenceConfig.parse(elo2026);
const sub = (id: string, typeKey: string, status = "submitted" as const) => ({
  id,
  typeKey,
  status,
});
const c = (
  submissionId: string,
  personId: string,
  role: Contribution["role"],
  status: Contribution["status"] = "confirmed",
) => ({ submissionId, personId, role, status });

describe("presenterCapReport", () => {
  const submissions = [
    sub("s1", "talk"),
    sub("s2", "talk"),
    sub("s3", "performance"),
    sub("s4", "panel"),
    sub("s5", "talk"),
  ];

  it("flags people holding more counted roles than the cap", () => {
    const report = presenterCapReport(
      config,
      submissions,
      [c("s1", "ana", "lead"), c("s2", "ana", "presenter"), c("s3", "ana", "lead")],
      ["submitted"],
    );
    expect(report.max).toBe(2);
    expect(report.over).toEqual([{ personId: "ana", count: 3, submissionIds: ["s1", "s2", "s3"] }]);
  });

  it("does not count panels, co-authorship, or other statuses", () => {
    const report = presenterCapReport(
      config,
      [...submissions, sub("s6", "talk", "withdrawn" as never)],
      [
        c("s1", "bo", "lead"),
        c("s4", "bo", "lead"), // panel: excluded type
        c("s2", "bo", "coauthor"), // role not counted
        c("s6", "bo", "lead"), // withdrawn
      ],
      ["submitted"],
    );
    expect(report.over).toEqual([]);
    expect(report.counts).toEqual([{ personId: "bo", count: 1, submissionIds: ["s1"] }]);
  });

  it("returns an empty report when the conference has no cap", () => {
    const noCap = { ...config, rules: { presenterCap: null } };
    expect(presenterCapReport(noCap, submissions, [c("s1", "x", "lead")], ["submitted"])).toEqual({
      max: null,
      counts: [],
      over: [],
      pendingCount: 0,
    });
  });
});

describe("presenter cap and invitations", () => {
  it("counts only confirmed roles, so nobody can push someone else over the cap", () => {
    const report = presenterCapReport(
      config,
      [sub("s1", "talk"), sub("s2", "talk"), sub("s3", "talk")],
      [
        c("s1", "eve", "lead"),
        c("s2", "eve", "presenter"),
        c("s3", "eve", "presenter", "invited"),
        c("s3", "x", "lead", "declined"),
      ],
      ["submitted"],
    );
    expect(report.over).toEqual([]);
    expect(report.counts).toEqual([{ personId: "eve", count: 2, submissionIds: ["s1", "s2"] }]);
    expect(report.pendingCount).toBe(1);
  });
});
