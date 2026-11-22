import AxeBuilder from "@axe-core/playwright";
import {
  type APIRequestContext,
  type Browser,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

/*
 * A reviewer's screens on a phone (spec 03, §1.4): "My reviews", a proposal with its review
 * form, a review that was sent, and "I cannot review this proposal". One reviewer is signed in
 * for the whole file, once: reviewer-30 of the seeded sandbox, which is in review. Sign-in
 * links are rationed per address, and the suite runs beside itself on one server.
 *
 * The sandbox gives reviewer-30 the artistic committee, whose formats are reviewed both ways:
 * exhibition works with the authors' names shown, performances anonymized. The chairs'
 * guidelines for that committee are seeded, and so are a description of its first criterion, a
 * fewest number of words for the comments, and the day reviews are due.
 *
 * WHICH PROPOSALS THESE TESTS WRITE TO, by rule. Other tests read the sandbox beside this file:
 * smoke.spec.ts reads a proposal of reviewer-1 (another committee: never one of these), and
 * settings.spec.ts has a chair who compares the Assignments list before and after assigning,
 * and who reads, at the end, the review this file sends. So:
 * - reviewer-30's proposals are taken in the order of their ids, which is the same for whoever
 *   asks and whatever was written since;
 * - the first test only READS: the anonymized one, and the LAST of those reviewed with names;
 * - the others WRITE only to proposals reviewed with names, never the last one, and each takes
 *   the first of them that has no review yet (`writable`). The one that is given back has no
 *   review and, once given back, is no longer among reviewer-30's: nothing here reads it again;
 * - the one test that RELEASES an assignment gives back a proposal that is reviewer-30's when it
 *   does, and no other test names a proposal of reviewer-30's: the chair's Assignments test in
 *   settings.spec.ts leaves out of what it compares every proposal reviewer-30 reviewed when it
 *   began, and keeps reviewer-30 out of the people it assigns;
 * - the last thing this file writes is the changed review with FINAL as its comments: the chair
 *   in settings.spec.ts waits for exactly that text, and reads it on the proposal's page;
 * - a second attempt of this file on the same server (a retry) takes the next two proposals by
 *   the same rule, and leaves a second review with FINAL: reviewer-30 has ten proposals
 *   reviewed with names, so there are enough, and the chair in settings.spec.ts reads the first
 *   such review it finds and counts what it counts from the server's own answers.
 * Nothing here moves a phase, and nothing else moves the sandbox's (the phase control is tried
 * on a conference of its own): reviews are written only while the conference is in review.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const REVIEWER = "reviewer-30@example.org";
const SANDBOX = "sandbox";
const RESTORED = "Your unsaved changes were restored from this device. Review them, then save.";
/** The notice where the review was saved somewhere else since the unsaved text was typed. */
const RESTORED_MOVED =
  "Your unsaved changes were restored from this device. This review was saved somewhere else since you made them, in another tab or on another device, and they would replace what was saved there. Check them, then save or send, or discard them.";
/** The comments of the review as it is last sent. settings.spec.ts holds the same words. */
const FINAL =
  "Browser test, final version: the piece holds together, and the plan to show it online is clear enough to stage.";
/** The note left when a proposal is given back. settings.spec.ts holds the same words. */
const GIVEN_BACK = "Browser test: away from the desk until the reviews are due.";

type Row = {
  submissionId: string;
  title: string;
  typeKey: string;
  language: string;
  status: "not_started" | "draft" | "sent";
};
type Mine = {
  conference: { slug: string; timezone: string };
  open: boolean;
  reviewsDue: string | null;
  counts: { sent: number; draft: number; notStarted: number };
  committees: {
    key: string;
    name: Record<string, string>;
    guidelines: Record<string, string> | null;
  }[];
  formats: Record<string, Record<string, string>>;
  proposals: Row[];
};
/** What the pages read of the conference: the committee's form, as the chairs worded it. */
type Conference = {
  config: {
    title: Record<string, string>;
    timezone: string;
    contactEmail: string;
    deadlines: { reviewsDue?: string };
    reviewPools: {
      key: string;
      name: Record<string, string>;
      blindMode: "double" | "single" | "open";
      guidelines?: Record<string, string>;
      criteria: {
        key: string;
        label: Record<string, string>;
        description?: Record<string, string>;
        min: number;
        max: number;
      }[];
      form: {
        comments: { minWords?: number; maxWords?: number; description?: Record<string, string> };
        chairNote: { enabled: boolean };
        recommendation: { enabled: boolean };
      };
    }[];
    submissionTypes: {
      key: string;
      name: Record<string, string>;
      reviewPool: string;
      blindMode?: "double" | "single" | "open";
    }[];
  };
};

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

/** axe in the light theme and again with the phone set to dark mode. */
async function expectAccessibleInBothThemes(page: Page) {
  await expectAccessible(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page);
  await page.emulateMedia({ colorScheme: "light" });
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Nothing scrolls sideways at either of the phone widths the app is held to. */
async function expectFitsBothWidths(page: Page) {
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 390, height: 844 });
}

/** House rule 8: anything people tap is at least 44px tall. */
async function expectTouchTarget(target: Locator) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

async function newPhone(browser: Browser) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "en-US",
    timezoneId: "Europe/Lisbon",
  });
  return context.newPage();
}

/** Sign in with the emailed code (the path the installed app uses). */
async function signIn(page: Page, request: APIRequestContext, email: string) {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  // The sign-in email, by its kind: other email may reach the same address meanwhile.
  const mail = await request.get(
    `/api/_test/outbox/latest?kind=magic_link&to=${encodeURIComponent(email)}`,
  );
  const code = /\b(\d{4}) (\d{4})\b/.exec(((await mail.json()) as { text: string }).text);
  await page.getByLabel("Code from the email").fill(`${code?.[1]}${code?.[2]}`);
  await page.getByRole("button", { name: "Sign in with code" }).click();
  await expect(page).toHaveURL(/\/en\/me$/);
}

/** What the app keeps unsaved in this browser (apps/web/src/unsaved.ts), by storage key. */
const unsavedKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("elochair:unsaved:")));

const words = (n: number) =>
  Array.from({ length: n }, (_, i) => ["light", "screen", "voice", "paper", "wire"][i % 5]).join(
    " ",
  );

/** A date and time as the pages show one, in a time zone. */
const shownIn = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    new Date(iso),
  );

test.describe("a reviewer's screens", () => {
  // One reviewer, signed in once, for all of them: sign-in links are rationed per address.
  test.describe.configure({ mode: "serial" });
  let page: Page;
  const failures: string[] = [];

  test.beforeAll(async ({ browser, request }) => {
    page = await newPhone(browser);
    page.on("pageerror", (e) => failures.push(e.message));
    await signIn(page, request, REVIEWER);
  });
  test.afterAll(() => page.context().close());

  const conference = async () =>
    (await (await page.request.get(`/api/conferences/${SANDBOX}`)).json()) as Conference;
  /** Reviewer-30's own list for the sandbox, as the server gives it. */
  const mine = async () => {
    const all = (await (await page.request.get("/api/me/reviews")).json()) as {
      conferences: Mine[];
    };
    const here = all.conferences.find((k) => k.conference.slug === SANDBOX);
    if (!here) throw new Error("reviewer-30 has no list for the sandbox");
    return here;
  };
  /** The rule at the top of this file: which proposals are read, and which may be written to. */
  const chosen = async () => {
    const [{ config }, list] = await Promise.all([conference(), mine()]);
    const poolOf = (typeKey: string) => {
      const type = config.submissionTypes.find((x) => x.key === typeKey);
      const pool = config.reviewPools.find((x) => x.key === type?.reviewPool);
      if (!type || !pool) throw new Error(`the sandbox has no committee for ${typeKey}`);
      return { type, pool, blind: type.blindMode ?? pool.blindMode };
    };
    const byId = [...list.proposals].sort((a, b) => a.submissionId.localeCompare(b.submissionId));
    const anonymized = byId.filter((p) => poolOf(p.typeKey).blind === "double");
    const named = byId.filter((p) => poolOf(p.typeKey).blind !== "double");
    const [read] = anonymized;
    const kept = named.at(-1);
    if (!read || !kept) throw new Error("reviewer-30 has no proposal reviewed each way");
    return {
      config,
      list,
      poolOf,
      /** Read, never written to. */
      read: { anonymized: read, named: kept },
      /** Reviewed with names, not the one that is read, and without a review yet. */
      writable: named.slice(0, -1).filter((p) => p.status === "not_started"),
    };
  };

  /** The guidelines are the text the conference holds, whole, laid out with its line breaks. */
  async function expectGuidelines(name: string, text: string | undefined, open: boolean) {
    const box = page.locator("details.guidelines-box");
    await expect(box.locator("summary")).toHaveText(name);
    await expectTouchTarget(box.locator("summary"));
    // On the list they are open; above a proposal they are one press away.
    if (!open) {
      await expect(box.locator("p")).toBeHidden();
      await box.locator("summary").click();
    }
    await expect(box.locator("p")).toBeVisible();
    expect(await box.locator("p").textContent()).toBe(text);
    await expect(box.locator("p")).toHaveCSS("white-space", "pre-wrap");
  }

  test("a reviewer reads the proposals assigned to them: the text, and the authors only where the review shows them", async () => {
    const { read, poolOf } = await chosen();
    const { anonymized, named } = read;
    // The guidelines the chairs wrote for the committee that reviews both formats, as the
    // conference holds them: in three languages, in paragraphs.
    const guidelines = poolOf(anonymized.typeKey).pool.guidelines;
    expect(guidelines?.en, "guidelines for the reviewer's committee").toContain("\n\n");
    expect(guidelines?.es).toBeTruthy();
    expect(poolOf(named.typeKey).pool.guidelines).toEqual(guidelines);
    if (!guidelines) return;
    const abstractOf = async (id: string) =>
      ((await (await page.request.get(`/api/submissions/${id}`)).json()) as { abstract: string })
        .abstract;

    // Anonymized: the proposal's text, a line saying why nobody is named, and no list of people.
    await page.goto(`/en/s/${anonymized.submissionId}`);
    await expect(page.getByRole("heading", { level: 1, name: anonymized.title })).toBeVisible();
    await expect(
      page.getByText(
        "You are reading this proposal as one of its reviewers. The review is anonymized: the authors' names are not shown.",
      ),
    ).toBeVisible();
    await expectGuidelines("Guidelines for reviewers", guidelines.en, false);
    await expect(
      page.getByText((await abstractOf(anonymized.submissionId)).slice(0, 60)),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "People" })).toHaveCount(0);
    // Nobody's address, and under the proposal the reviewer's own form, which is theirs to fill.
    await expect(page.locator("main")).not.toContainText("@example.org");
    await expect(page.getByRole("heading", { level: 2, name: "Your review" })).toBeVisible();
    await expectAccessibleInBothThemes(page);
    await expectFitsBothWidths(page);

    // Names shown: the people are listed, still without an address, and the line says that
    // this committee sees them.
    await page.goto(`/en/s/${named.submissionId}`);
    await expect(page.getByRole("heading", { level: 1, name: named.title })).toBeVisible();
    await expect(
      page.getByText(
        "You are reading this proposal as one of its reviewers. This committee sees who the authors are; they never learn who reviewed their proposal.",
      ),
    ).toBeVisible();
    await expect(page.getByText("the authors' names are not shown")).toHaveCount(0);
    // The same guidelines: they are the committee's, however the format is reviewed.
    await expectGuidelines("Guidelines for reviewers", guidelines.en, false);
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
    await expect(page.locator("main li").first()).toContainText("Lead author");
    await expect(page.locator("main")).not.toContainText("@example.org");
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);

    // In Spanish the sentences are Spanish, and the guidelines are the ones written in Spanish.
    await page.goto(`/es/s/${anonymized.submissionId}`);
    await expect(
      page.getByText(
        "Estás leyendo esta propuesta como una de las personas que la revisan. La revisión es anónima",
      ),
    ).toBeVisible();
    await expectGuidelines("Pautas para quienes revisan", guidelines.es, false);
    await expect(page.getByRole("heading", { level: 2, name: "Tu revisión" })).toBeVisible();
    // Nothing was written to either: both are as they were found.
    const after = await mine();
    for (const p of [anonymized, named]) {
      expect(after.proposals.find((x) => x.submissionId === p.submissionId)?.status).toBe(p.status);
    }
  });

  test("My reviews lists the reviewer's own proposals, with the day reviews are due, the guidelines and where each review stands", async () => {
    const { config, list } = await chosen();
    await page.goto("/en/me");
    // The main menu offers the list to someone who reviews.
    const link = page.locator(".site-header").getByRole("link", { name: "My reviews" });
    await expectTouchTarget(link);
    await link.click();
    await expect(page).toHaveURL(/\/en\/reviews$/);
    // A new page: its heading takes focus, and the menu marks where the person is.
    await expect(page.getByRole("heading", { level: 1, name: "My reviews" })).toBeFocused();
    await expect(link).toHaveAttribute("aria-current", "page");

    const section = page.getByRole("region", { name: config.title.en ?? "" });
    const committee = list.committees.map((c) => c.name.en).join(", ");
    await expect(section.getByText(`You review for: ${committee}`)).toBeVisible();
    // The day reviews are due, as the conference states it. It locks nothing, and the page says so.
    const due = config.deadlines.reviewsDue;
    expect(due, "the sandbox has a day reviews are due").toBeTruthy();
    expect(list.reviewsDue).toBe(due);
    await expect(
      section.getByText(
        `Reviews are due ${shownIn(due ?? "", config.timezone)} (${config.timezone}).`,
      ),
    ).toBeVisible();
    const { sent, draft, notStarted } = list.counts;
    await expect(
      section.getByText(
        `${sent} of ${list.proposals.length} sent · ${draft === 1 ? "1 draft" : `${draft} drafts`} · ${notStarted} not started`,
      ),
    ).toBeVisible();
    await expect(
      section.getByText(
        "You can send and change your reviews for as long as the conference is in review.",
      ),
    ).toBeVisible();
    // The chairs' guidelines for the committee, open where the reviewer starts.
    await expectGuidelines("Guidelines for reviewers", list.committees[0]?.guidelines?.en, true);

    // Every proposal assigned to them, each with its format, the language of its abstract and
    // where their review of it stands; each leads to the proposal's page.
    const cards = section.getByRole("list", { name: "Proposals assigned to you" }).locator("> li");
    await expect(cards).toHaveCount(list.proposals.length);
    const STATUS = { not_started: "Not started", draft: "Draft", sent: "Sent" };
    const LANGUAGE: Record<string, string> = { en: "English", es: "Español", pt: "Português" };
    for (const [i, p] of list.proposals.entries()) {
      const card = cards.nth(i);
      await expect(card.getByRole("link")).toHaveText(p.title);
      await expect(card.getByRole("link")).toHaveAttribute("href", `/en/s/${p.submissionId}`);
      await expect(card.locator(".row .meta")).toHaveText(
        `${list.formats[p.typeKey]?.en} · ${LANGUAGE[p.language] ?? p.language}`,
      );
      await expect(card.locator(".badge")).toHaveText(STATUS[p.status]);
    }
    await expectTouchTarget(cards.first().getByRole("link"));
    await expect(
      page.getByText(
        "You see only the proposals assigned to you. Nobody else who reviews them is shown.",
      ),
    ).toBeVisible();
    // Nobody is named on it: no reviewer, no author, no address.
    await expect(page.locator("main")).not.toContainText("@example.org");
    await expectAccessibleInBothThemes(page);
    await expectFitsBothWidths(page);

    // In Spanish and in Portuguese the page is in that language.
    await page.goto("/es/reviews");
    await expect(page.getByRole("heading", { level: 1, name: "Mis revisiones" })).toBeVisible();
    await expect(page.getByText("Solo ves las propuestas que tienes asignadas.")).toBeVisible();
    await expect(page.locator("details.guidelines-box summary")).toHaveText(
      "Pautas para quienes revisan",
    );
    await expectNoHorizontalScroll(page);
    await page.goto("/pt/reviews");
    await expect(page.getByRole("heading", { level: 1, name: "As minhas revisões" })).toBeVisible();
    await expect(page.getByText("Vê apenas as propostas que lhe foram atribuídas.")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("unsaved text in a review survives a reload or a lost tab, until it is discarded", async () => {
    const { writable, poolOf } = await chosen();
    const [target] = writable;
    if (!target) throw new Error("no proposal without a review is left for this test");
    const { pool } = poolOf(target.typeKey);
    const first = pool.criteria[0];
    if (!first) throw new Error("the committee has no criterion");
    const key = `review:${target.submissionId}`;
    const url = `/en/s/${target.submissionId}`;
    await page.goto(url);
    const comments = page.getByLabel("Comments for the authors");
    const score = page.getByRole("group", { name: first.label.en }).getByRole("radio", {
      name: String(first.max),
      exact: true,
    });
    const restored = page.getByText(RESTORED);
    await expect(comments).toHaveValue("");
    expect(await unsavedKeys(page)).toEqual([]);

    // Typed, not saved, and the page goes away at once: the text is written on the way out.
    await comments.fill("Typed and not saved yet.");
    await score.check();
    await page.reload();
    await expect(comments).toHaveValue("Typed and not saved yet.");
    await expect(score).toBeChecked();
    await expect(restored).toBeVisible();
    // Kept under the reviewer's own id, apart from anyone else's on this device.
    const keys = await unsavedKeys(page);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.endsWith(`:${key}`)).toBe(true);
    const discard = page.getByRole("button", { name: "Discard unsaved changes" });
    await expectTouchTarget(discard);
    await expectAccessibleInBothThemes(page);

    // A tab that dies says no goodbye: the proposal opened again, in another tab, has the text.
    const again = await page.context().newPage();
    await again.goto(url);
    await expect(again.getByLabel("Comments for the authors")).toHaveValue(
      "Typed and not saved yet.",
    );
    await expect(again.getByText(RESTORED)).toBeVisible();
    await again.close();

    // Discarding goes back to the review as it is saved (here, nothing): the line says so and
    // takes focus, and nothing is kept in the browser any more.
    await discard.click();
    await expect(page.getByText("Unsaved changes discarded.")).toBeFocused();
    await expect(comments).toHaveValue("");
    await expect(score).not.toBeChecked();
    await expect(restored).toHaveCount(0);
    await expect.poll(() => unsavedKeys(page)).toEqual([]);
    await page.reload();
    await expect(comments).toHaveValue("");
    await expect(restored).toHaveCount(0);
    // None of it ever reached the server: the review has not been started.
    const after = await mine();
    expect(after.proposals.find((p) => p.submissionId === target.submissionId)?.status).toBe(
      "not_started",
    );
  });

  test("I cannot review this proposal: a reason and a note for the chairs, and the proposal leaves the list", async () => {
    const { writable, list } = await chosen();
    // The first proposal that has no review, by the rule at the top: it is reviewer-30's now,
    // no other test reads it, and nothing here reads it again once it is given back.
    const [target] = writable;
    if (!target) throw new Error("no proposal without a review is left for this test");
    await page.goto(`/en/s/${target.submissionId}`);
    const link = page.getByRole("link", { name: "I cannot review this proposal" });
    await expectTouchTarget(link);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/en/s/${target.submissionId}/cannot-review$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "I cannot review this proposal" }),
    ).toBeFocused();
    await expect(page.locator("main").getByText(target.title, { exact: true })).toBeVisible();
    // What telling the chairs does, before it is done.
    await expect(
      page.getByText(
        "The chairs are told by email that a proposal was given back. On its page they see who gave it back, with your reason and your note, and they can give it to someone else. It leaves your list, and you can no longer open it.",
      ),
    ).toBeVisible();
    const why = page.getByRole("group", { name: "Why?" });
    await expect(why.getByRole("radio")).toHaveCount(3);
    for (const reason of [
      "I have a conflict of interest, or I know whose work this is",
      "It is outside what I can judge",
      "I do not have the time",
    ]) {
      await expect(why.getByRole("radio", { name: reason, exact: true })).not.toBeChecked();
    }
    await expectTouchTarget(why.locator("label.choice").first());
    await expect(why).toContainText(
      "After a conflict of interest, the proposal is never assigned to you again.",
    );
    const tell = page.getByRole("button", { name: "Tell the chairs" });
    const cancel = page.getByRole("link", { name: "Cancel" });
    await expectTouchTarget(tell);
    await expectTouchTarget(cancel);
    await expectAccessibleInBothThemes(page);
    await expectFitsBothWidths(page);

    // Without a reason nothing is sent: the page says what is missing, beside it.
    await tell.click();
    const summary = page.getByRole("alert");
    await expect(summary).toBeFocused();
    await expect(summary.getByRole("link", { name: "Choose a reason." })).toBeVisible();
    await expect(why.getByText("Choose a reason.")).toBeVisible();
    expect((await mine()).proposals).toHaveLength(list.proposals.length);
    await expectAccessible(page);

    // Cancel goes back to the proposal, and nothing has happened.
    await cancel.click();
    await expect(page).toHaveURL(new RegExp(`/en/s/${target.submissionId}$`));
    await expect(page.getByRole("heading", { level: 1, name: target.title })).toBeFocused();
    await page.getByRole("link", { name: "I cannot review this proposal" }).click();

    await why.getByRole("radio", { name: "I do not have the time" }).check();
    await page.getByLabel("Note for the chairs (optional)").fill(GIVEN_BACK);
    await tell.click();
    // Back on the list, which says what was done, in a line that takes focus.
    await expect(page).toHaveURL(/\/en\/reviews$/);
    const said = page.getByRole("status").filter({ hasText: "has left your list" });
    await expect(said).toHaveText(
      `“${target.title}” has left your list. The chairs can see that you cannot review it, and can give it to someone else.`,
    );
    await expect(said).toBeFocused();
    await expect(
      page.getByRole("list", { name: "Proposals assigned to you" }).locator("> li"),
    ).toHaveCount(list.proposals.length - 1);
    await expect(page.locator(`a[href="/en/s/${target.submissionId}"]`)).toHaveCount(0);
    await expectAccessible(page);

    // From then on it is to them what it is to a stranger: its page, and both its addresses.
    await page.goto(`/en/s/${target.submissionId}`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "We could not find that proposal, or you cannot see it.",
      }),
    ).toBeVisible();
    await page.goto(`/en/s/${target.submissionId}/cannot-review`);
    await expect(page.getByText("This proposal is not assigned to you.")).toBeVisible();
    for (const path of ["", "/review"]) {
      const res = await page.request.get(`/api/submissions/${target.submissionId}${path}`);
      expect(res.status(), path).toBe(404);
    }
  });

  test("a review is saved as a draft, is there after a reload, is sent, and is changed after it was sent", async () => {
    test.slow();
    const { config, writable, poolOf } = await chosen();
    // The first proposal that has no review, by the rule at the top.
    const [target] = writable;
    if (!target) throw new Error("no proposal without a review is left for this test");
    const { pool } = poolOf(target.typeKey);
    const [merit, ...others] = pool.criteria;
    if (!merit) throw new Error("the committee has no criterion");
    const min = pool.form.comments.minWords;
    expect(min, "the sandbox's committee asks for a fewest number of words").toBeGreaterThan(1);
    const listRow = async () =>
      (await mine()).proposals.find((p) => p.submissionId === target.submissionId);

    await page.goto(`/en/s/${target.submissionId}`);
    const review = page.getByRole("region", { name: "Your review" });
    // What the form is, and who reads what, in plain words.
    await expect(
      review.getByText(
        "The chairs read your review and know it is yours. The authors receive your comments for them, without your name and without the scores.",
      ),
    ).toBeVisible();
    await expect(
      review.getByText(
        `Score each criterion. ${merit.min} is the lowest, ${merit.max} the highest.`,
      ),
    ).toBeVisible();
    // Each criterion on its own scale, with what the chairs wrote about it where they did.
    const group = (label: string) => review.getByRole("group", { name: label, exact: true });
    for (const criterion of pool.criteria) {
      const scale = group(criterion.label.en ?? "");
      await expect(scale.getByRole("radio")).toHaveCount(criterion.max - criterion.min + 1);
      if (criterion.description?.en) {
        await expect(scale.getByText(criterion.description.en)).toBeVisible();
        await expect(
          scale.getByRole("radio", { name: String(criterion.min), exact: true }),
        ).toHaveAccessibleDescription(criterion.description.en);
      }
    }
    expect(merit.description?.en, "the sandbox describes its first criterion").toBeTruthy();
    await expectTouchTarget(
      group(merit.label.en ?? "")
        .locator("label.scale-choice")
        .first(),
    );
    const comments = review.getByLabel("Comments for the authors");
    const note = review.getByLabel("Note for the chairs only (optional)");
    // The standard wording, until the chairs write their own; and the chairs' limit, counted.
    await expect(comments).toHaveAccessibleDescription(
      new RegExp(
        `^The authors receive this with the decision\\. Say what is strong, what is unclear, and what would improve it\\. 0 words \\(at least ${min}\\)$`,
      ),
    );
    await expect(note).toHaveAccessibleDescription("The authors never see this.");
    const recommendation = review.getByRole("group", { name: "Your recommendation" });
    await expect(recommendation.getByRole("radio")).toHaveCount(3);
    await expectTouchTarget(recommendation.locator("label.choice").first());
    const send = review.getByRole("button", { name: "Send review" });
    const saveDraft = review.getByRole("button", { name: "Save draft" });
    await expectTouchTarget(send);
    await expectTouchTarget(saveDraft);
    await expectTouchTarget(comments);
    const said = review.getByRole("status");
    await expectAccessibleInBothThemes(page);
    await expectFitsBothWidths(page);

    // Sending needs everything the form requires: each problem is said beside its field, and
    // in a list at the top that takes focus. Nothing is sent.
    await send.click();
    const summary = review.getByRole("alert");
    await expect(summary).toBeFocused();
    await expect(summary.getByRole("heading")).toHaveText(
      "Before you send your review, fix the following:",
    );
    await expect(summary.getByRole("listitem")).toHaveCount(pool.criteria.length + 2);
    await expect(
      summary.getByRole("link", { name: `${merit.label.en}: This is required.` }),
    ).toBeVisible();
    await expect(
      summary.getByRole("link", { name: "Comments for the authors: This is required." }),
    ).toBeVisible();
    await expect(
      summary.getByRole("link", { name: "Your recommendation: This is required." }),
    ).toBeVisible();
    await expect(comments).toHaveAttribute("aria-invalid", "true");
    await expect(group(merit.label.en ?? "").getByText("This is required.")).toBeVisible();
    expect((await listRow())?.status).toBe("not_started");
    await expectAccessibleInBothThemes(page);
    // A link in the list leads to its field.
    await summary
      .getByRole("link", { name: "Comments for the authors: This is required." })
      .click();
    await expect(comments).toBeFocused();

    // A draft keeps whatever is filled in, however incomplete. The page says what a draft is.
    const pick = (label: string, n: number) =>
      group(label).getByRole("radio", { name: String(n), exact: true });
    await pick(merit.label.en ?? "", merit.min + 1).check();
    await comments.fill(words(3));
    await expect(review.getByText(`3 words (at least ${min})`)).toBeVisible();
    await saveDraft.click();
    await expect(said).toHaveText(
      "Draft saved. The chairs see your review only once you send it. You can change it after sending, while the conference is in review.",
    );
    await expect(said).toBeFocused();
    await expect(summary).toHaveCount(0);
    await expect.poll(() => unsavedKeys(page)).toEqual([]);
    expect((await listRow())?.status).toBe("draft");

    // After a reload it is as it was saved: the server keeps it, not the browser.
    await page.reload();
    await expect(comments).toHaveValue(words(3));
    await expect(pick(merit.label.en ?? "", merit.min + 1)).toBeChecked();
    await expect(page.getByText(RESTORED)).toHaveCount(0);
    await expect(
      review.getByText(
        "This is a draft. Only you can see it: the chairs see your review once you send it.",
      ),
    ).toBeVisible();
    // Typed here and not saved, while the same draft is saved somewhere else (another device):
    // after a reload what was typed is back on top of the newer draft, and the page says that it
    // would replace what was saved there. It says so again after every reload, until the
    // reviewer has saved or discarded it. Nothing is overwritten unasked.
    await comments.fill("Typed on this device and not saved.");
    await expect.poll(() => unsavedKeys(page)).toHaveLength(1);
    const elsewhere = await page.request.put(`/api/submissions/${target.submissionId}/review`, {
      headers: { origin: new URL(page.url()).origin },
      data: {
        version: 1,
        send: false,
        scores: { [merit.key]: merit.min + 1 },
        comments: "Saved on another device.",
        chairNote: "",
        recommendation: null,
      },
    });
    expect(elsewhere.status()).toBe(200);
    const moved = review.getByText(RESTORED_MOVED);
    for (let reloads = 0; reloads < 2; reloads++) {
      await page.reload();
      await expect(moved).toBeVisible();
      await expect(page.getByText(RESTORED)).toHaveCount(0);
      await expect(comments).toHaveValue("Typed on this device and not saved.");
    }
    await expectAccessibleInBothThemes(page);
    await expectFitsBothWidths(page);
    // Discarded, the form holds what the other device saved, and the browser keeps nothing.
    await review.getByRole("button", { name: "Discard unsaved changes" }).click();
    await expect(comments).toHaveValue("Saved on another device.");
    await expect(moved).toHaveCount(0);
    await expect.poll(() => unsavedKeys(page)).toEqual([]);
    // Back to the three words, saved on the version the page now holds.
    await comments.fill(words(3));
    await saveDraft.click();
    await expect(said).toHaveText(/^Draft saved\./);
    await expect.poll(() => unsavedKeys(page)).toEqual([]);

    // The list says so too.
    await page.goto("/en/reviews");
    const card = page
      .locator("li.card")
      .filter({ has: page.locator(`a[href="/en/s/${target.submissionId}"]`) });
    await expect(card.locator(".badge")).toHaveText("Draft");
    await card.getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1, name: target.title })).toBeFocused();

    // Too few words for the committee's limit: said beside the comments, with the count.
    for (const criterion of pool.criteria)
      await pick(criterion.label.en ?? "", merit.max - 1).check();
    await recommendation.getByRole("radio", { name: "Unsure" }).check();
    await send.click();
    await expect(summary.getByRole("listitem")).toHaveCount(1);
    await expect(
      review.getByText(`At least ${min} words needed (3 now).`, { exact: true }),
    ).toBeVisible();
    expect((await listRow())?.status).toBe("draft");

    // Complete, it is sent: the page says so, and shows the review as the chairs now read it.
    const firstText = `Browser test, first version: ${words(12)}.`;
    await comments.fill(firstText);
    await send.click();
    await expect(said).toHaveText(
      "Your review was sent. The chairs can read it now. You can change it while the conference is in review.",
    );
    await expect(said).toBeFocused();
    await expect(
      review.getByText(
        /^Your review was sent on .+\. You can change it while the conference is in review\.$/,
      ),
    ).toBeVisible();
    for (const criterion of pool.criteria) {
      await expect(
        review
          .locator(".review-scores > div")
          .filter({ hasText: criterion.label.en })
          .locator("dd"),
      ).toHaveText(`${merit.max - 1} of ${criterion.max}`);
    }
    await expect(
      review
        .locator(".review-scores > div")
        .filter({ hasText: "Your recommendation" })
        .locator("dd"),
    ).toHaveText("Unsure");
    await expect(review.getByText(firstText)).toBeVisible();
    await expect(review.getByText("You wrote none.")).toBeVisible();
    // Nothing to type in any more, until they ask to change it.
    await expect(review.getByRole("textbox")).toHaveCount(0);
    const change = review.getByRole("button", { name: "Change my review" });
    await expectTouchTarget(change);
    await expectTouchTarget(review.getByRole("link", { name: "Back to my reviews" }));
    // Once a review is sent, the proposal is not given back: they change the review, or write
    // to the chairs.
    await expect(page.getByRole("link", { name: "I cannot review this proposal" })).toHaveCount(0);
    await expect(
      page.getByText(
        "You have sent your review of this proposal, so it stays yours to review. If you can no longer stand by it, change it, or write to the chairs:",
      ),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: config.contactEmail })).toHaveAttribute(
      "href",
      `mailto:${config.contactEmail}`,
    );
    expect((await listRow())?.status).toBe("sent");
    await expectAccessibleInBothThemes(page);
    await expectFitsBothWidths(page);
    // After a reload it is still the sent review that shows.
    await page.reload();
    await expect(review.getByText(firstText)).toBeVisible();
    await expect(change).toBeVisible();

    // Changing it opens the form again, with what was sent in it. Its heading takes focus.
    await change.click();
    await expect(review.getByRole("heading", { level: 2, name: "Your review" })).toBeFocused();
    await expect(
      review.getByText(
        "You are changing a review that was sent. The chairs read the version you sent until you send this one.",
      ),
    ).toBeVisible();
    await expect(comments).toHaveValue(firstText);
    await expect(saveDraft).toHaveCount(0);
    // Leaving it as it was sent takes back what was typed, after asking.
    await comments.fill("Typed, then taken back.");
    page.once("dialog", (dialog) => dialog.accept());
    await review.getByRole("button", { name: "Leave the review as it was sent" }).click();
    await expect(review.getByText(firstText)).toBeVisible();
    await expect.poll(() => unsavedKeys(page)).toEqual([]);

    // Changed and sent again: the first criterion at the top of its scale, the others one and
    // two below it, the note for the chairs left empty, and the comments as the chair reads them.
    await change.click();
    await pick(merit.label.en ?? "", merit.max).check();
    for (const [i, criterion] of others.entries()) {
      await pick(criterion.label.en ?? "", merit.max - 1 - i).check();
    }
    await recommendation.getByRole("radio", { name: "Accept" }).check();
    await comments.fill(FINAL);
    await send.click();
    await expect(said).toHaveText(
      "Your changed review was sent. The chairs now read this version.",
    );
    await expect(said).toBeFocused();
    await expect(
      review.getByText(
        /^Your review was sent on .+ and last changed on .+\. You can change it while the conference is in review\.$/,
      ),
    ).toBeVisible();
    await expect(review.getByText(FINAL)).toBeVisible();
    await expect(
      review.locator(".review-scores > div").filter({ hasText: merit.label.en }).locator("dd"),
    ).toHaveText(`${merit.max} of ${merit.max}`);
    await expect(
      review
        .locator(".review-scores > div")
        .filter({ hasText: "Your recommendation" })
        .locator("dd"),
    ).toHaveText("Accept");
    const stored = (await (
      await page.request.get(`/api/submissions/${target.submissionId}/review`)
    ).json()) as { status: string; comments: string; version: number };
    expect(stored).toMatchObject({ status: "sent", comments: FINAL });

    // In Portuguese the page is in Portuguese.
    await page.goto(`/pt/s/${target.submissionId}`);
    await expect(page.getByRole("heading", { level: 2, name: "A sua revisão" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Alterar a minha revisão" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // The pages rendered every time: none fell back to "Something went wrong".
    expect(failures).toEqual([]);
  });

  /*
   * The emails of the review phase, as often as the reviewer wants them (spec 03, §1.7). It is
   * after the test above on purpose: settings.spec.ts waits for the review that one sends.
   * Reviewer-30's choices are nobody else's to read, and no test assigns reviewer-30 anything,
   * so no email follows from what is chosen here. A second attempt of this file finds the
   * choices the first one left: the page is held to what the server says they are, and the
   * test chooses the others.
   */
  test("a reviewer chooses how often they are emailed, on Your account, and the choices are kept", async () => {
    type Choices = {
      conference: { slug: string; title: Record<string, string> };
      reviewer: {
        assignments: "each" | "daily" | "none";
        reminder: boolean;
        reminderDays: number;
      } | null;
      chair: { notices: string } | null;
    };
    const mineNow = async () => {
      const all = (await (await page.request.get("/api/me/notifications")).json()) as {
        conferences: Choices[];
      };
      return all.conferences;
    };
    const before = await mineNow();
    // Reviewer-30 reviews at the sandbox and nowhere else, and chairs nothing.
    expect(before.map((k) => k.conference.slug)).toEqual([SANDBOX]);
    const [here] = before;
    if (!here?.reviewer) throw new Error("reviewer-30 has no email choices at the sandbox");
    expect(here.chair).toBeNull();
    // Someone who has chosen nothing gets one summary a day, and the reminder.
    if (test.info().retry === 0) {
      expect(here.reviewer).toEqual({ assignments: "daily", reminder: true, reminderDays: 3 });
    }
    const title = here.conference.title.en ?? "";
    const LABELS = {
      each: "An email for each one",
      daily: "One summary a day",
      none: "No email",
    } as const;

    await page.goto("/en/me");
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
    const emails = page.getByRole("region", { name: "Emails about reviewing" });
    await expect(emails.getByRole("heading", { level: 3, name: title })).toBeVisible();
    const assigned = emails.getByRole("group", { name: "When proposals are assigned to you" });
    await expect(assigned.getByRole("radio")).toHaveCount(3);
    await expect(assigned.locator("label")).toHaveText([LABELS.each, LABELS.daily, LABELS.none]);
    await expect(
      assigned.getByRole("radio", { name: LABELS[here.reviewer.assignments] }),
    ).toBeChecked();
    const reminder = emails.getByRole("checkbox", {
      name: "Remind me 3 days before reviews are due",
    });
    await expect(reminder).toBeChecked({ checked: here.reviewer.reminder });
    // What cannot be turned off is said, and why.
    await expect(
      emails.getByText(
        "Invitations and sign-in emails are always sent: without them you could not take part.",
      ),
    ).toBeVisible();
    // The chairs' notices are not a reviewer's to choose: they are not on the page.
    await expect(emails.getByRole("group", { name: /^As a chair/ })).toHaveCount(0);
    const save = emails.getByRole("button", { name: `Save email choices for ${title}` });
    await expect(save).toHaveText("Save");
    for (const label of await assigned.locator("label").all()) await expectTouchTarget(label);
    await expectTouchTarget(emails.locator("label").filter({ hasText: "Remind me" }));
    await expectTouchTarget(save);
    await expectAccessibleInBothThemes(page);
    await expectFitsBothWidths(page);

    // The other choices, saved: the page says so, and the line that says it takes focus.
    const next = {
      assignments: here.reviewer.assignments === "each" ? ("none" as const) : ("each" as const),
      reminder: !here.reviewer.reminder,
    };
    await assigned.getByRole("radio", { name: LABELS[next.assignments] }).check();
    await reminder.setChecked(next.reminder);
    await save.click();
    const said = emails.getByRole("status");
    await expect(said).toHaveText(`Your email choices for ${title} are saved.`);
    await expect(said).toBeFocused();
    expect((await mineNow())[0]?.reviewer).toEqual({ ...next, reminderDays: 3 });

    // Kept: after a reload they are what was chosen, and nothing says "saved" any more.
    await page.reload();
    await expect(assigned.getByRole("radio", { name: LABELS[next.assignments] })).toBeChecked();
    await expect(reminder).toBeChecked({ checked: next.reminder });
    await expect(said).toHaveText("");
    await expectAccessibleInBothThemes(page);
    // An email's link to these choices leads to this part of the page, from wherever the
    // person is: its heading takes focus.
    await page.goto("/en/reviews");
    await page.goto("/en/me#emails");
    await expect(
      page.getByRole("heading", { level: 2, name: "Emails about reviewing" }),
    ).toBeFocused();
    await expect(assigned.getByRole("radio", { name: LABELS[next.assignments] })).toBeChecked();

    // In Spanish and in Portuguese the choices are in that language.
    for (const [lang, heading, legend, always] of [
      [
        "es",
        "Correos sobre la revisión",
        "Cuando te asignen propuestas",
        "Las invitaciones y los correos para entrar se envían siempre: sin ellos no podrías participar.",
      ],
      [
        "pt",
        "Emails sobre a revisão",
        "Quando lhe forem atribuídas propostas",
        "Os convites e os emails para entrar são sempre enviados: sem eles não poderia participar.",
      ],
    ] as const) {
      await page.goto(`/${lang}/me`);
      const part = page.getByRole("region", { name: heading });
      await expect(part.getByRole("group", { name: legend }).getByRole("radio")).toHaveCount(3);
      await expect(part.getByText(always)).toBeVisible();
      await expectFitsBothWidths(page);
    }
    expect(failures).toEqual([]);
  });
});
