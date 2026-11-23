import type { ReviewPool } from "@elochair/schema";
import { EMPTY_REVIEW, type ReviewContent } from "@elochair/schema/pure";
import { describe, expect, it } from "vitest";
import { forgetPerson, openUnsaved, readUnsaved, type Store, writeUnsaved } from "./unsaved";
import { reviewScope, unsavedOfReview, withUnsavedReview } from "./unsavedReview";

/*
 * A review's unsaved changes, as the browser keeps them: what goes in is what differs from the
 * saved review, and what comes back is only what the form still has a place for.
 */

/** A committee whose form is as the app words it: two criteria, a note and a recommendation. */
const plain: ReviewPool = {
  key: "plain",
  name: { en: "Plain committee" },
  blindMode: "double",
  reviewsPerSubmission: 2,
  criteria: [
    { key: "fit", label: { en: "Fit" }, min: 1, max: 5 },
    { key: "clarity", label: { en: "Clarity" }, min: 1, max: 5 },
  ],
  form: { comments: {}, chairNote: { enabled: true }, recommendation: { enabled: true } },
};
/** One whose chairs took the note and the recommendation off, and score from 1 to 3. */
const bare: ReviewPool = {
  key: "bare",
  name: { en: "Bare committee" },
  blindMode: "single",
  reviewsPerSubmission: 1,
  criteria: [{ key: "fit", label: { en: "Fit" }, min: 1, max: 3 }],
  form: { comments: {}, chairNote: { enabled: false }, recommendation: { enabled: false } },
};

const saved: ReviewContent = {
  scores: { fit: 4 },
  comments: "As it was saved.",
  chairNote: "",
  recommendation: null,
};

describe("a review's unsaved changes", () => {
  it("are kept under the proposal, apart from the proposal's own unsaved text", () => {
    expect(reviewScope("abc")).toBe("review:abc");
    expect(reviewScope("abc")).not.toBe("submission:abc");
  });

  it("are what differs from the saved review, and nothing when nothing does", () => {
    expect(unsavedOfReview(saved, saved)).toEqual({});
    expect(unsavedOfReview(saved, { ...saved, scores: { ...saved.scores } })).toEqual({});
    expect(
      unsavedOfReview(saved, {
        scores: { fit: 5, clarity: 2 },
        comments: "As it is typed now.",
        chairNote: "Between us.",
        recommendation: "unsure",
      }),
    ).toEqual({
      "scores.fit": 5,
      "scores.clarity": 2,
      comments: "As it is typed now.",
      chairNote: "Between us.",
      recommendation: "unsure",
    });
    // A score and a recommendation taken back are recorded as cleared.
    expect(
      unsavedOfReview({ ...saved, recommendation: "accept" }, { ...saved, scores: {} }),
    ).toEqual({ "scores.fit": null, recommendation: null });
  });

  it("come back on top of the saved review, changed values only", () => {
    const typed: ReviewContent = {
      scores: { fit: 2, clarity: 5 },
      comments: "Typed, then the tab was lost.",
      chairNote: "A note.",
      recommendation: "reject",
    };
    expect(withUnsavedReview(saved, unsavedOfReview(saved, typed), plain)).toEqual(typed);
    expect(withUnsavedReview(saved, {}, plain)).toEqual(saved);
    expect(withUnsavedReview(saved, { "scores.fit": null }, plain)).toEqual({
      ...saved,
      scores: {},
    });
    expect(withUnsavedReview(EMPTY_REVIEW, { comments: "Only this." }, plain)).toEqual({
      ...EMPTY_REVIEW,
      comments: "Only this.",
    });
  });

  it("leave out what the form has no place for now, and keep the saved answer there", () => {
    const kept = {
      "scores.fit": 9,
      "scores.gone": 3,
      "scores.clarity": 2.5,
      comments: 5,
      chairNote: ["not", "text"],
      recommendation: "maybe",
      somethingElse: "x",
    };
    // A score off its scale, for a criterion that is gone, or not a whole number; a text that
    // is not one; a recommendation that is none of the three: none of it comes back.
    expect(withUnsavedReview(saved, kept, plain)).toEqual(saved);
  });

  it("put back no note and no recommendation on a form that has neither, and fit the saved review too", () => {
    const before: ReviewContent = {
      scores: { fit: 5, clarity: 4 },
      comments: "Written when the form had more.",
      chairNote: "A saved note.",
      recommendation: "accept",
    };
    expect(
      withUnsavedReview(
        before,
        { chairNote: "A typed note.", recommendation: "reject", "scores.fit": 3 },
        bare,
      ),
    ).toEqual({
      // The typed score fits the scale of 1 to 3; the saved one of another criterion is gone.
      scores: { fit: 3 },
      comments: "Written when the form had more.",
      chairNote: "",
      recommendation: null,
    });
    // With nothing typed, a saved score that is off the scale now is not shown either.
    expect(withUnsavedReview(before, {}, bare).scores).toEqual({});
  });
});

/** localStorage as a Map: one browser, shared by whoever signs in to it. */
function browser(): Store {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

describe("where a review's unsaved changes are kept", () => {
  const ANA = "0b7c5a52-0000-4000-8000-000000000001";
  const BRUNO = "0b7c5a52-0000-4000-8000-000000000002";
  const scope = reviewScope("5a1f0000-0000-4000-8000-000000000009");
  const typed = unsavedOfReview(saved, { ...saved, comments: "Typed and not saved." });

  it("under their reviewer: another account in the same browser is shown nothing of them", () => {
    const store = browser();
    const form = openUnsaved(store, ANA, scope);
    expect(form.write(2, typed)).toBe(true);
    // The reviewer finds them again, with the version of the review they were typed on.
    expect(openUnsaved(store, ANA, scope).found).toMatchObject({ version: 2, values: typed });
    // Someone else who reviews the same proposal on this browser finds nothing.
    expect(openUnsaved(store, BRUNO, scope).found).toBeNull();
    expect(readUnsaved(store, BRUNO, scope)).toBeNull();
    // Nor does the proposal's own editor, which keeps its text under another name.
    expect(readUnsaved(store, ANA, scope.replace("review:", "submission:"))).toBeNull();
  });

  it("gone on sign-out, and a form still open in another tab writes nothing back", () => {
    const store = browser();
    const form = openUnsaved(store, ANA, scope);
    const others = openUnsaved(store, BRUNO, scope);
    expect(form.write(2, typed)).toBe(true);
    expect(others.write(1, { comments: "Bruno's own." })).toBe(true);
    forgetPerson(store, ANA);
    expect(readUnsaved(store, ANA, scope)).toBeNull();
    expect(openUnsaved(store, ANA, scope).found).toBeNull();
    // The form that was open when they signed out no longer keeps what is typed in it.
    expect(form.write(2, typed)).toBe(false);
    expect(readUnsaved(store, ANA, scope)).toBeNull();
    // Nobody else's text went with it.
    expect(readUnsaved(store, BRUNO, scope)?.values).toEqual({ comments: "Bruno's own." });
  });

  it("gone once nothing is unsaved: after a save, and after it is discarded", () => {
    const store = browser();
    writeUnsaved(store, ANA, scope, 2, typed);
    expect(readUnsaved(store, ANA, scope)).not.toBeNull();
    writeUnsaved(store, ANA, scope, 3, unsavedOfReview(saved, saved));
    expect(readUnsaved(store, ANA, scope)).toBeNull();
  });
});
