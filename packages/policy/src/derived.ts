import {
  type ConferenceConfig,
  type Contribution,
  effectiveBlindMode,
  findType,
  type IdentityHint,
  type Person,
  type SelfIdWarning,
  type Submission,
  type SubmissionIssue,
  selfIdentificationWarnings,
  validateSubmission,
} from "@elochair/schema";

/*
 * Facts derived from a submission and its people. Projections decide who sees them; these
 * functions only compute. Invitees are always described by what the owner typed, never by
 * their profile, until they confirm.
 */

export type ShownIdentity = {
  displayName: string | null;
  affiliation: string | null;
  email: string | null;
};

/** How a contributor appears to people who are not chairs. */
export function shownIdentity(c: Contribution, person: Person | undefined): ShownIdentity {
  if (c.status === "confirmed") {
    return {
      displayName: person?.displayName ?? null,
      affiliation: person?.affiliation ?? null,
      email: person?.email ?? null,
    };
  }
  return {
    displayName: c.invitedName,
    affiliation: c.invitedAffiliation,
    email: c.invitedEmail,
  };
}

const live = (cs: Contribution[]) => cs.filter((c) => c.status !== "declined");

/** Identity details to look for in anonymized text (invitees: only what the owner typed). */
export function identityHints(
  contributions: Contribution[],
  people: Map<string, Person>,
): IdentityHint[] {
  return live(contributions).map((c) => {
    const p = people.get(c.personId);
    if (c.status === "confirmed" && p) {
      return {
        displayName: p.displayName,
        affiliation: p.affiliation,
        email: p.email,
        orcid: p.orcid,
      };
    }
    return {
      displayName: c.invitedName,
      affiliation: c.invitedAffiliation,
      email: c.invitedEmail ?? "",
      orcid: null,
    };
  });
}

/** Text reviewers read in double-blind review; empty for other blind modes. */
export function blindTexts(
  config: ConferenceConfig,
  s: Submission,
): { path: string; text: string }[] {
  if (effectiveBlindMode(config, s.typeKey) !== "double") return [];
  const type = findType(config, s.typeKey);
  const texts = [
    { path: "title", text: s.title },
    { path: "abstract", text: s.abstract },
  ];
  for (const f of type?.fields ?? []) {
    const v = s.fields[f.key];
    if (f.identifying || typeof v !== "string") continue;
    texts.push({ path: `fields.${f.key}`, text: v });
  }
  return texts;
}

export function selfIdFindings(
  config: ConferenceConfig,
  s: Submission,
  contributions: Contribution[],
  people: Map<string, Person>,
): SelfIdWarning[] {
  return selfIdentificationWarnings(blindTexts(config, s), identityHints(contributions, people));
}

/** Rule violations, with contributor names taken from profiles or invitations. */
export function submissionIssues(
  config: ConferenceConfig,
  s: Submission,
  contributions: Contribution[],
  people: Map<string, Person>,
): SubmissionIssue[] {
  return validateSubmission(
    config,
    s,
    contributions.map((c) => ({
      role: c.role,
      status: c.status,
      hasName: Boolean(shownIdentity(c, people.get(c.personId)).displayName?.trim()),
    })),
  );
}
