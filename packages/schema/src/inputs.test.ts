import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Key } from "./config";
import { Assignment, AssignmentRelease, roleInvitationState } from "./domain";
import { LocalizedText } from "./i18n";
import {
  AnswerInvitationInput,
  AssignmentsPoolQuery,
  AssignmentsQuery,
  AssignReviewerInput,
  OneLine,
  ProfileInput,
  RoleInvitationAnswerInput,
  RoleInvitationInput,
  RoleRemovalInput,
  UpdateSubmissionInput,
} from "./inputs";
import { removeStrayInvisible } from "./invisible";

const name = OneLine(200);

describe("one-line text: names, affiliations, pronouns", () => {
  it.each([
    "Ana Lucía Pérez",
    "João Carlos Gonçalves",
    "Ñuñez Ibáñez",
    "O'Brien",
    "D’Angelo",
    "Jean-Luc Picard",
    "Anne-Marie de la Cruz",
    "J. R. R. Tolkien",
    "王小明",
    "李",
    "محمد عبد الله",
    "فاطمة الزهراء",
    "Νίκος Παπαδόπουλος",
    "Дмитрий Иванов",
    "प्रिया शर्मा",
    "김민지",
    "שרה כהן",
    // A Persian compound surname, joined with a zero-width non-joiner.
    "مریم حسینی\u200Cنژاد",
    "Studio 404",
    "they/them",
    // An emoji sequence built with a zero-width joiner.
    "they/them \u{1F3F3}\u{FE0F}\u200D\u{1F308}",
  ])("accepts %j", (s) => {
    expect(name.safeParse(s).success).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["   ", "blank"],
    ["Ana\nPérez", "a line break"],
    ["Ana\u0000", "NUL"],
    ["Ana\u2028Pérez", "a line separator"],
    ["Ana\u2029Pérez", "a paragraph separator"],
    ["\u200B", "only a zero-width space"],
    ["Ana\u200BPérez", "a zero-width space"],
    ["\u202Eevil.exe", "a right-to-left override"],
    ["Ana \u2066Pérez\u2069", "bidi isolates"],
    ["Ana\u200FPérez", "a right-to-left mark"],
    ["An\uFEFFa", "a byte-order mark inside"],
    ["Ana\u00ADPérez", "a soft hyphen"],
    ["\u200C", "a lone zero-width non-joiner"],
    ["Ana \u200D", "a zero-width joiner outside a word"],
    ["\u3164", "only a Hangul filler (a letter, but invisible)"],
    ["---", "no letter or digit"],
    ["—", "only a dash"],
    [". .", "only punctuation"],
  ])("refuses %j (%s)", (s) => {
    expect(name.safeParse(s).success).toBe(false);
  });

  const cp = (...points: number[]) => String.fromCodePoint(...points);
  const ZWJ = 0x200d;
  /** Tag characters spelling `text`, as in subdivision flags (and in hidden-text tricks). */
  const tags = (text: string) => cp(...[...text].map((c) => 0xe0000 + c.charCodeAt(0)));
  const BLACK_FLAG = 0x1f3f4;
  const CANCEL_TAG = 0xe007f;

  it.each([
    ["woman artist, medium skin tone", `she/her ${cp(0x1f469, 0x1f3fd, ZWJ, 0x1f3a8)}`],
    ["technologist, dark skin tone", `ela/dela ${cp(0x1f9d1, 0x1f3ff, ZWJ, 0x1f4bb)}`],
    [
      "couple with heart, two skin tones",
      `they ${cp(0x1f9d1, 0x1f3fb, ZWJ, 0x2764, 0xfe0f, ZWJ, 0x1f9d1, 0x1f3ff)}`,
    ],
    ["thumbs up with a skin tone", `they ${cp(0x1f44d, 0x1f3fd)}`],
    ["woman artist", `she/her ${cp(0x1f469, ZWJ, 0x1f3a8)}`],
    ["family", `he/him ${cp(0x1f468, ZWJ, 0x1f469, ZWJ, 0x1f467)}`],
    ["transgender flag", `they/them ${cp(0x1f3f3, 0xfe0f, ZWJ, 0x26a7, 0xfe0f)}`],
    ["the flag of Scotland", `she ${cp(BLACK_FLAG)}${tags("gbsct")}${cp(CANCEL_TAG)}`],
    ["the flag of Wales", `he ${cp(BLACK_FLAG)}${tags("gbwls")}${cp(CANCEL_TAG)}`],
    ["a letter from outside the BMP", `${cp(0x1d49c)}na Pérez`],
  ])("accepts emoji and astral characters: %s", (_, s) => {
    expect(name.safeParse(s).success).toBe(true);
  });

  it.each([
    ["a lone tag character", `Ana${tags("g")}`],
    ["tags without a flag", `Ana ${tags("gbsct")}${cp(CANCEL_TAG)}`],
    ["tags after another pictograph", `she ${cp(0x1f3f3)}${tags("gbsct")}${cp(CANCEL_TAG)}`],
    ["a flag's tags without the cancel tag", `she ${cp(BLACK_FLAG)}${tags("gbsct")}`],
    ["a black flag and only the cancel tag", `she ${cp(BLACK_FLAG, CANCEL_TAG)}`],
    [
      "hidden words in tags after a flag",
      `Ana ${cp(BLACK_FLAG)}${tags("ignoreall")}${cp(CANCEL_TAG)}`,
    ],
    ["hidden text with spaces", `Ana ${cp(BLACK_FLAG)}${tags("gb sct")}${cp(CANCEL_TAG)}`],
    // Only the three standard emoji flags (England, Scotland, Wales) keep their tags: anything
    // else after a black flag could spell hidden text six characters at a time.
    [
      "a subdivision flag outside the emoji set",
      `ela ${cp(BLACK_FLAG)}${tags("usca")}${cp(CANCEL_TAG)}`,
    ],
    [
      "hidden words split into flag-shaped chunks",
      `Ana ${["ignore", "allpre", "vious"].map((w) => `${cp(BLACK_FLAG)}${tags(w)}${cp(CANCEL_TAG)}`).join("")}`,
    ],
    ["a joiner after a skin tone, at the end", `they ${cp(0x1f44d, 0x1f3fd, ZWJ)}`],
    ["a joiner after a skin tone, before a space", `she ${cp(0x1f469, 0x1f3fd, ZWJ)} x`],
    ["a skin tone then a right-to-left mark", `she ${cp(0x1f469, 0x1f3fd, 0x200f)}`],
    ["a lone high surrogate", `Ana ${String.fromCharCode(0xd800)} Pérez`],
    ["a lone low surrogate", `${String.fromCharCode(0xdc00)}Ana`],
    ["surrogates in the wrong order", `Ana ${String.fromCharCode(0xdc00, 0xd800)}`],
  ])("refuses %s", (_, s) => {
    expect(name.safeParse(s).success).toBe(false);
  });

  it("applies to the name an invitee gives when confirming", () => {
    const answer = (displayName: string) =>
      AnswerInvitationInput.safeParse({ answer: "confirm", displayName }).success;
    expect(answer("Nina Newbie")).toBe(true);
    expect(answer("\u200B")).toBe(false);
  });
});

describe("free text: title, abstract, field values and bios", () => {
  const update = (patch: Record<string, unknown>) =>
    UpdateSubmissionInput.safeParse({ version: 1, ...patch }).success;
  const profile = (bios: Record<string, string>) =>
    ProfileInput.safeParse({
      displayName: "Ana",
      affiliation: null,
      country: null,
      languages: [],
      pronouns: null,
      orcid: null,
      bios,
    }).success;

  it("keeps line breaks and tabs", () => {
    const text = "First line\nsecond line\r\nthird\tline";
    expect(update({ title: "A\ttitle", abstract: text })).toBe(true);
    expect(update({ fields: { needs: text, platforms: ["web", "VR\nheadset"] } })).toBe(true);
    expect(update({ fields: { consent: true, minutes: 30 } })).toBe(true);
    expect(profile({ en: text, es: "Biografía." })).toBe(true);
  });

  it.each([
    ["NUL", "\u0000"],
    ["escape", "\u001B"],
    ["backspace", "\u0008"],
    ["delete", "\u007F"],
    ["next line (C1)", "\u0085"],
  ])("refuses %s", (_, ch) => {
    const text = `a${ch}b`;
    expect(update({ title: text })).toBe(false);
    expect(update({ abstract: text })).toBe(false);
    expect(update({ fields: { needs: text } })).toBe(false);
    expect(update({ fields: { platforms: ["web", text] } })).toBe(false);
    expect(profile({ en: text })).toBe(false);
  });

  it.each([
    ["a lone high surrogate", String.fromCharCode(0xd800)],
    ["a lone low surrogate", String.fromCharCode(0xdc00)],
    ["a reversed pair", String.fromCharCode(0xdc00, 0xd800)],
  ])("refuses %s (Postgres refuses it in JSON: a 500, not a 400)", (_, ch) => {
    const text = `a${ch}b`;
    expect(update({ title: text })).toBe(false);
    expect(update({ abstract: text })).toBe(false);
    expect(update({ fields: { needs: text } })).toBe(false);
    expect(update({ fields: { platforms: ["web", text] } })).toBe(false);
    expect(profile({ en: text })).toBe(false);
    expect(LocalizedText.safeParse({ en: text }).success).toBe(false);
  });

  it("keeps characters outside the BMP, which are written as surrogate pairs", () => {
    const text = `Olas ${String.fromCodePoint(0x1f30a)} y ${String.fromCodePoint(0x1d49c)}`;
    expect(text).toHaveLength(12);
    expect(update({ title: text, abstract: text })).toBe(true);
    expect(update({ fields: { needs: text, platforms: [text] } })).toBe(true);
    expect(profile({ en: text })).toBe(true);
    expect(LocalizedText.safeParse({ en: text }).success).toBe(true);
  });
});

describe("machine keys", () => {
  it("are at most 64 characters", () => {
    expect(Key.safeParse("a".repeat(64)).success).toBe(true);
    expect(Key.safeParse("a".repeat(65)).success).toBe(false);
  });

  it("bound custom-field keys in submissions", () => {
    const fields = (key: string) =>
      UpdateSubmissionInput.safeParse({ version: 1, fields: { [key]: "x" } }).success;
    expect(fields(`k${"x".repeat(63)}`)).toBe(true);
    expect(fields(`olga_owner_universidad_imaginaria_del_caribe_${"x".repeat(30)}`)).toBe(false);
  });
});

describe("what the browser sends, the server accepts", () => {
  // The web's cleanName(): stray invisible characters removed, then outer spaces trimmed.
  const cleanName = (typed: string) => removeStrayInvisible(typed).trim();
  const cp = (...points: number[]) => String.fromCodePoint(...points);
  const atoms = [
    ..."Aé ",
    ...[0x928, 0x94d, 0x92e, 0xd30, 0xd4d, 0x646, 0x6cc, 0x1820, 0x3002, 0x202f].map((c) => cp(c)),
    ...[0x200c, 0x200d, 0x200b, 0xfe0f, 0x1f469, 0x1f3fd, 0x1f3a8].map((c) => cp(c)),
  ];
  it("OneLine accepts any cleaned name that still has a letter or digit", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...atoms), { minLength: 1, maxLength: 20 }), (parts) => {
        const sent = cleanName(parts.join(""));
        if (!/[\p{L}\p{N}]/u.test(sent)) return;
        expect(name.safeParse(sent).success).toBe(true);
      }),
      { numRuns: 30_000 },
    );
  });
});

describe("invitations to a role (spec 03, §1.2)", () => {
  const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
    schema.safeParse(v).success;
  const reviewer = {
    email: "ana@example.org",
    role: "reviewer",
    pools: ["scientific"],
    lang: "es",
  };
  const chair = { email: "ana@example.org", role: "chair", lang: "pt" };

  it("an invitation is an address, a role, a reviewer's pools and a language, and nothing else", () => {
    expect(RoleInvitationInput.parse(reviewer)).toEqual(reviewer);
    // A chair has no pools: none sent is none.
    expect(RoleInvitationInput.parse(chair)).toEqual({ ...chair, pools: [] });
    expect(ok(RoleInvitationInput, { ...chair, name: "Ana María Pérez-Gómez" })).toBe(true);
    for (const more of [
      { personId: "00000000-0000-4000-8000-000000000001" },
      { scope: [] },
      { expiresAt: "2099-01-01T00:00:00Z" },
      { token: "x".repeat(40) },
      { affiliation: "Somewhere" },
    ]) {
      expect(ok(RoleInvitationInput, { ...chair, ...more }), JSON.stringify(more)).toBe(false);
    }
  });

  it("offers a reviewer's and a chair's role only, a reviewer with pools and a chair without", () => {
    for (const role of ["track_chair", "admin", "site_admin", "owner", ""]) {
      expect(ok(RoleInvitationInput, { ...chair, role }), role).toBe(false);
    }
    expect(ok(RoleInvitationInput, { ...reviewer, pools: [] })).toBe(false);
    expect(ok(RoleInvitationInput, { ...reviewer, pools: undefined })).toBe(false);
    expect(ok(RoleInvitationInput, { ...reviewer, pools: ["a", "a"] })).toBe(false);
    expect(ok(RoleInvitationInput, { ...reviewer, pools: ["Not A Key"] })).toBe(false);
    expect(ok(RoleInvitationInput, { ...chair, pools: ["scientific"] })).toBe(false);
    expect(ok(RoleInvitationInput, { ...chair, lang: "fr" })).toBe(false);
    expect(ok(RoleInvitationInput, { ...chair, email: "two@example.org, three@example.org" })).toBe(
      false,
    );
    // The name is one line of ordinary text, like every name.
    expect(ok(RoleInvitationInput, { ...chair, name: "Two\nlines" })).toBe(false);
    expect(ok(RoleInvitationInput, { ...chair, name: "Hid\u202Eden" })).toBe(false);
  });

  it("an answer is a token and a choice, with what the invitee says of themselves", () => {
    const token = "role_".padEnd(48, "x");
    expect(ok(RoleInvitationAnswerInput, { token, answer: "decline" })).toBe(true);
    expect(
      ok(RoleInvitationAnswerInput, {
        token,
        answer: "accept",
        displayName: "Ana Pérez",
        languages: ["pt", "en"],
        maxLoad: 30,
      }),
    ).toBe(true);
    // Nothing in it says who answers, or what is given: unknown keys are refused.
    for (const more of [
      { email: "someone@example.org" },
      { personId: "00000000-0000-4000-8000-000000000001" },
      { role: "chair" },
      { pools: ["scientific"] },
      { conferenceId: "00000000-0000-4000-8000-000000000002" },
    ]) {
      expect(
        ok(RoleInvitationAnswerInput, { token, answer: "accept", ...more }),
        JSON.stringify(more),
      ).toBe(false);
    }
    for (const bad of [
      { answer: "confirm" },
      { token: "short" },
      { maxLoad: 0 },
      { maxLoad: 31 },
      { maxLoad: 2.5 },
      { maxLoad: "8" },
      { languages: [] },
      { languages: ["fr"] },
      { languages: ["en", "en"] },
      { displayName: " " },
    ]) {
      expect(
        ok(RoleInvitationAnswerInput, { token, answer: "accept", ...bad }),
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("a removal sends the number of proposals the confirmation showed, or nothing", () => {
    expect(RoleRemovalInput.parse({})).toEqual({});
    expect(RoleRemovalInput.parse({ assignments: 0 })).toEqual({ assignments: 0 });
    for (const bad of [
      { assignments: -1 },
      { assignments: 1.5 },
      { assignments: "3" },
      { force: true },
    ]) {
      expect(ok(RoleRemovalInput, bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("an invitation waits until it expires, unless it was answered or cancelled", () => {
    const now = new Date("2031-03-01T12:00:00Z");
    const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
    const state = (v: {
      answer?: "accepted" | "declined";
      cancelled?: boolean;
      expires?: number;
    }) =>
      roleInvitationState(
        {
          answer: v.answer ?? null,
          cancelledAt: v.cancelled ? at(-1000) : null,
          expiresAt: at(v.expires ?? 1000),
        },
        now,
      );
    expect(state({})).toBe("waiting");
    expect(state({ expires: 1 })).toBe("waiting");
    // The moment it expires, it has expired.
    expect(state({ expires: 0 })).toBe("expired");
    expect(state({ expires: -1000 })).toBe("expired");
    expect(state({ answer: "declined" })).toBe("declined");
    expect(state({ answer: "accepted", expires: -1000 })).toBe("accepted");
    expect(state({ cancelled: true })).toBe("cancelled");
    // A declined or expired one that a chair took off the list is cancelled; an accepted one
    // stays accepted, because the role it gave is what is removed.
    expect(state({ answer: "declined", cancelled: true })).toBe("cancelled");
    expect(state({ expires: -1000, cancelled: true })).toBe("cancelled");
    expect(state({ answer: "accepted", cancelled: true })).toBe("accepted");
  });
});

describe("assignments (spec 03, §1.3)", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
    schema.safeParse(v).success;

  it("assigning names one reviewer, and may say the chair was shown they are full; nothing else", () => {
    expect(AssignReviewerInput.parse({ reviewerId: id(1) })).toEqual({ reviewerId: id(1) });
    expect(ok(AssignReviewerInput, { reviewerId: id(1), confirmedFull: true })).toBe(true);
    for (const bad of [
      {},
      { reviewerId: "not-an-id" },
      { reviewerId: [id(1), id(2)] },
      { reviewerId: id(1), confirmedFull: "yes" },
      // Nothing in the request can name the proposal, a reason, or who assigns.
      { reviewerId: id(1), submissionId: id(2) },
      { reviewerId: id(1), assignedByPersonId: id(3) },
      { reviewerId: id(1), releaseReason: "conflict" },
    ]) {
      expect(ok(AssignReviewerInput, bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("the Assignments page is asked for by a page size, and a pool's next page by a cursor too", () => {
    expect(AssignmentsQuery.parse({})).toEqual({ limit: 50 });
    expect(AssignmentsQuery.parse({ limit: "200" })).toEqual({ limit: 200 });
    expect(AssignmentsPoolQuery.parse({ limit: "20", cursor: "" })).toEqual({
      limit: 20,
      cursor: "",
    });
    expect(ok(AssignmentsPoolQuery, { cursor: "s".padEnd(105, "A") })).toBe(true);
    for (const bad of [{ limit: "0" }, { limit: "201" }, { limit: "2.5" }, { pool: "x" }]) {
      expect(ok(AssignmentsQuery, bad), JSON.stringify(bad)).toBe(false);
      expect(ok(AssignmentsPoolQuery, bad), JSON.stringify(bad)).toBe(false);
    }
    // The page as a whole has no cursor: each pool's list has its own.
    expect(ok(AssignmentsQuery, { cursor: "" })).toBe(false);
    expect(ok(AssignmentsPoolQuery, { cursor: "short" })).toBe(false);
  });

  it("an assignment says nothing of a release: the record of one is a thing of its own", () => {
    const assignment = {
      id: id(1),
      conferenceId: id(2),
      reviewerId: id(3),
      submissionId: id(4),
      createdAt: "2027-02-15T12:00:00Z",
      dueAt: null,
      assignedByPersonId: null,
    };
    expect(ok(Assignment, assignment)).toBe(true);
    // An assignment is one that stands: it has no field that could say otherwise.
    expect(Object.keys(Assignment.shape).sort()).toEqual(Object.keys(assignment).sort());
    const release = {
      id: id(5),
      conferenceId: id(2),
      submissionId: id(4),
      reviewerId: id(3),
      assignmentId: id(1),
      assignedByPersonId: id(6),
      assignedAt: "2027-02-15T12:00:00Z",
      releasedByPersonId: id(6),
      releasedAt: "2027-02-16T12:00:00Z",
      reason: "chair",
    };
    expect(ok(AssignmentRelease, release)).toBe(true);
    for (const reason of ["chair", "conflict", "expertise", "time", "role_removed"]) {
      expect(ok(AssignmentRelease, { ...release, reason }), reason).toBe(true);
    }
    // The people named in it may be gone, and the record stays.
    expect(
      ok(AssignmentRelease, {
        ...release,
        reviewerId: null,
        assignedByPersonId: null,
        releasedByPersonId: null,
      }),
    ).toBe(true);
    for (const bad of [
      { ...release, reason: "withdrawn" },
      { ...release, reason: null },
      { ...release, releasedAt: null },
      { ...release, submissionId: null },
    ]) {
      expect(ok(AssignmentRelease, bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
