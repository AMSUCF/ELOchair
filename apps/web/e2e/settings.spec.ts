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
 * Conference settings (spec 02, §1.9), as a chair uses them on a phone. The tests share one
 * server with the others and run beside them, so they change only what no other test reads
 * (the length of a reading or performance, the day decisions are sent, a pool's guidelines,
 * the label of one criterion, the end of the Spanish invitation, the Portuguese wording of
 * the notice about a deleted draft, and the wording and limits of one pool's review form with
 * the day reviews are due) and put it back. The tests that read the invitation on the
 * front page read the Spanish one by its beginning. No blind mode is ever saved: other tests read who is shown to reviewers. Of the
 * emails, the others read the invitation, the receipt, the answer to the owner and the notice
 * to people invited to withdrawn work: those are reworded here only as far as the review step.
 * Nothing about an agreement is ever saved either: the others accept the call's agreements at
 * the versions they find, and a new version would refuse them.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const CALL = "elo2027-open";
const FORMAT = "Reading or performance";
const RESTORED = "Your unsaved changes were restored from this device. Review them, then save.";
const words = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => ["electronic", "literature", "poem", "machine", "reader"][i % 5],
  ).join(" ");

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
  const mail = await request.get(`/api/_test/outbox/latest?to=${encodeURIComponent(email)}`);
  const code = /\b(\d{4}) (\d{4})\b/.exec(((await mail.json()) as { text: string }).text);
  await page.getByLabel("Code from the email").fill(`${code?.[1]}${code?.[2]}`);
  await page.getByRole("button", { name: "Sign in with code" }).click();
  await expect(page).toHaveURL(/\/en\/me$/);
}

/** What the app keeps unsaved in this browser (apps/web/src/unsaved.ts), by storage key. */
const unsavedKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("elochair:unsaved:")));

/** The values of the one buffer this browser keeps (the settings screen's), or null for none. */
const unsavedValues = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("elochair:unsaved:"));
    const kept = key ? localStorage.getItem(key) : null;
    return kept ? (JSON.parse(kept) as { values: Record<string, unknown> }).values : null;
  });

/** The collapsible section of one format on the settings screen. */
const formatSection = (page: Page) =>
  page.locator("details").filter({ has: page.locator("summary", { hasText: FORMAT }) });

/**
 * A collapsible section of the settings screen, by the name on it (a review pool, an email);
 * opened if it is closed.
 */
async function openPool(page: Page, name: string) {
  const summary = page.locator("summary", { hasText: name });
  const section = page.locator("details").filter({ has: summary });
  await expectTouchTarget(summary);
  if ((await section.getAttribute("open")) === null) await summary.click();
  return section;
}

/** What the tests read of a stored configuration, to change it and put it back whatever it says. */
type Stored = {
  token: string;
  config: {
    title: Record<string, string>;
    defaultLanguage: string;
    timezone: string;
    deadlines: {
      submissionsClose: string;
      notification: string;
      reviewsDue?: string;
    };
    distinction?: Record<string, string>;
    invitation?: Record<string, string>;
    contributionGroups: {
      key: string;
      name: Record<string, string>;
      summary: Record<string, string>;
      formats: string[];
    }[];
    messages?: Record<string, { subject?: Record<string, string>; body?: Record<string, string> }>;
    agreements: {
      key: string;
      title: Record<string, string>;
      text?: Record<string, string>;
      url?: string;
      version: string;
    }[];
    reviewPools: {
      key: string;
      name: Record<string, string>;
      blindMode: "double" | "single" | "open";
      reviewsPerSubmission: number;
      guidelines?: Record<string, string>;
      criteria: {
        key: string;
        label: Record<string, string>;
        description?: Record<string, string>;
        min: number;
        max: number;
      }[];
      form: {
        comments: { description?: Record<string, string>; minWords?: number; maxWords?: number };
        chairNote: { enabled: boolean; description?: Record<string, string> };
        recommendation: { enabled: boolean; description?: Record<string, string> };
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

const stored = async (page: Page, call: string) =>
  (await (await page.request.get(`/api/conferences/${call}/settings`)).json()) as Stored;

/** How each blind mode is said to a chair. */
const SHOWN = {
  double:
    "Anonymized: reviewers do not see who the authors are, or the answers marked as identifying (such as a link to the work)",
  single: "Reviewers see the authors' names and affiliations",
  open: "Reviewers see the authors' names, affiliations and bios",
};

/** The format's card on the public page of the call (other cards mention it in their text). */
const listedFormat = (page: Page) =>
  page.locator(".formats > li").filter({ has: page.locator("h3", { hasText: FORMAT }) });

async function openSettings(page: Page) {
  await page.goto(`/en/c/${CALL}/manage`);
  await page.getByRole("link", { name: "Conference settings" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/c/${CALL}/settings$`));
  // A new page: its heading takes focus.
  await expect(page.getByRole("heading", { level: 1, name: "Conference settings" })).toBeFocused();
}

/** Review what was typed and save it; the page says so and takes focus there. */
async function reviewAndSave(page: Page) {
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("heading", { name: "Review your changes" })).toBeFocused();
  await page.getByRole("button", { name: "Save changes" }).click();
  const status = page.getByRole("status");
  await expect(status).toHaveText("Settings saved.");
  await expect(status).toBeFocused();
}

const shownInBogota = (iso: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(iso));

test.describe("conference settings", () => {
  // One chair, signed in once, for all of them: sign-in links are rationed per address.
  test.describe.configure({ mode: "serial" });
  let chair: Page;

  test.beforeAll(async ({ browser, request }) => {
    chair = await newPhone(browser);
    await signIn(chair, request, "chair@example.org");
  });
  test.afterAll(() => chair.context().close());

  test("a chair changes a word limit and a deadline, reviews them and saves", async () => {
    test.slow();
    await openSettings(chair);
    // Every chair is told the same thing about what this screen does not offer.
    await expect(
      chair.getByText(
        "Formats, fields, languages, review pools, criteria and agreements are added or removed by importing a configuration on the server, not here.",
      ),
    ).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);

    // A format's values are in its own section, closed until asked for.
    const summary = chair.locator("summary", { hasText: FORMAT });
    await expectTouchTarget(summary);
    await summary.click();
    const format = formatSection(chair);
    const most = format.getByLabel("Most words in the abstract");
    await expect(most).toHaveValue("300");
    await expectTouchTarget(most);
    await most.fill("320");

    // A deadline is a date, a time and an offset, each as stored: this one is written in the
    // conference's own offset. Changing the date leaves the other two alone, and the line below
    // says which instant it now is.
    const decisions = chair.getByRole("group", { name: "Decisions sent" });
    const date = decisions.getByLabel("Date");
    const before = await date.inputValue();
    const time = await decisions.getByLabel("Time").inputValue();
    const after = new Date(Date.parse(`${before}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    await date.fill(after);
    await expect(decisions.getByLabel("Time")).toHaveValue(time);
    await expect(decisions.getByLabel("Offset from UTC")).toHaveValue("-05:00");
    await expect(decisions).toContainText(
      `${shownInBogota(`${after}T${time}:00-05:00`)} · Conference time (America/Bogota)`,
    );
    await expect(decisions).toContainText("Your time (Europe/Lisbon)");
    await expect(chair.getByText("Values changed and not saved yet: 2.")).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await chair.setViewportSize({ width: 360, height: 740 });
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 390, height: 844 });

    // Nothing is saved before it has been reviewed.
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await chair.getByRole("button", { name: "Review changes" }).click();
    const review = chair.getByRole("region", { name: "Review your changes" });
    await expect(chair.getByRole("heading", { name: "Review your changes" })).toBeFocused();
    await expect(review.getByRole("listitem")).toHaveCount(2);
    await expect(review).toContainText("Decisions sent");
    await expect(review).toContainText(`${FORMAT} · Most words in the abstract`);
    await expect(review).toContainText("from “300” to “320”");
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await expectTouchTarget(chair.getByRole("button", { name: "Save changes" }));
    // Editing again takes the review away: it was a review of something else.
    await most.fill("321");
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await most.fill("320");
    await expect(chair.getByRole("button", { name: "Save changes" })).toBeVisible();

    await chair.getByRole("button", { name: "Save changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Settings saved.");
    await expect(chair.getByRole("status")).toBeFocused();

    // The public page of the call shows the new values.
    await chair.goto(`/en/c/${CALL}`);
    await expect(listedFormat(chair)).toContainText("320 words at most");
    await expect(chair.locator(".timeline")).toContainText(
      shownInBogota(`${after}T${time}:00-05:00`),
    );

    // Back as they were, for the tests that run beside this one.
    await openSettings(chair);
    await chair.locator("summary", { hasText: FORMAT }).click();
    await formatSection(chair).getByLabel("Most words in the abstract").fill("300");
    await chair.getByRole("group", { name: "Decisions sent" }).getByLabel("Date").fill(before);
    await reviewAndSave(chair);
    await chair.goto(`/en/c/${CALL}`);
    await expect(listedFormat(chair)).toContainText("300 words at most");
  });

  test("a change that would make a submitted proposal invalid is refused, and says why", async ({
    page,
    request,
  }) => {
    test.slow();
    // Someone submits a reading with a 40-word abstract.
    await signIn(page, request, "e2e-settings-author@example.org");
    await page.getByLabel("Your name, as it should appear").fill("Rita Reader");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await page.goto(`/en/c/${CALL}`);
    await page.getByRole("link", { name: "Start a proposal" }).click();
    await page.getByRole("radio", { name: new RegExp(FORMAT) }).check();
    await page.getByRole("radio", { name: "In person" }).check();
    await page.getByRole("button", { name: /^Start a / }).click();
    await expect(page).toHaveURL(/\/en\/s\/[0-9a-f-]+$/);
    await page.getByLabel("Title").fill("A reading for forty words");
    await page.getByLabel("Abstract", { exact: true }).fill(words(40));
    const boxes = page.getByRole("checkbox", { name: /^I accept:/ });
    await expect(boxes.first()).toBeVisible();
    for (const box of await boxes.all()) await box.check();
    await page.getByRole("button", { name: "Submit proposal" }).click();
    await expect(page.getByText("Submitted. A receipt is on its way")).toBeVisible();

    // They do not chair the conference: the settings are not theirs to open.
    await page.goto(`/en/c/${CALL}/settings`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Conference settings" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText(
      "Only the chairs of this conference can change its settings.",
    );
    await expect(page.getByRole("button", { name: "Review changes" })).toHaveCount(0);
    // Nor do they review anywhere: the main menu, which has asked by now, offers them no list
    // of reviews. (The chair of these tests also reviews, at `chair-reviews`, and is offered it.)
    expect(await (await page.request.get("/api/me/menu")).json()).toEqual({ reviews: false });
    await expect(
      page.locator(".site-header").getByRole("link", { name: "My submissions" }),
    ).toBeVisible();
    await expect(
      page.locator(".site-header").getByRole("link", { name: "My reviews" }),
    ).toHaveCount(0);

    // The chair tries a limit of 30 words: the review says it cannot be saved, and why.
    await openSettings(chair);
    await chair.locator("summary", { hasText: FORMAT }).click();
    const most = formatSection(chair).getByLabel("Most words in the abstract");
    await most.fill("30");
    await chair.getByRole("button", { name: "Review changes" }).click();
    const review = chair.getByRole("region", { name: "Review your changes" });
    const blocked = review.getByRole("alert");
    await expect(blocked).toContainText(
      "These changes cannot be saved. Submitted proposals that would no longer be valid: 1.",
    );
    await expect(blocked).toContainText("Too many words: 1");
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expectTouchTarget(blocked.getByRole("link", { name: "Proposal 1" }));
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);

    // A value that cannot be right is said beside it, and nothing is offered to save.
    await most.fill("0");
    await chair.getByRole("button", { name: "Review changes" }).click();
    const summary = chair.getByRole("alert").filter({ hasText: "Please fix the following" });
    await expect(summary).toBeFocused();
    await expect(summary).toContainText(`${FORMAT} · Most words in the abstract: Enter 1 or more.`);
    await expect(formatSection(chair).locator(".field-error")).toHaveText("Enter 1 or more.");
    await expect(most).toHaveAttribute("aria-invalid", "true");
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expectAccessibleInBothThemes(chair);

    // Taken back, there is nothing to save and nothing to lose by leaving.
    await most.fill("300");
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Nothing has been changed.");
    await chair.goto(`/en/c/${CALL}`);
    await expect(listedFormat(chair)).toContainText("300 words at most");
  });

  test("a whole-number field must keep a whole number between its smallest and largest", async () => {
    await openSettings(chair);
    // The format, by its whole name: "Workshops" is one of the ways to contribute further down.
    await chair.locator("summary", { hasText: /^Workshop$/ }).click();
    const workshop = chair
      .locator("details")
      .filter({ has: chair.locator("summary", { hasText: /^Workshop$/ }) });
    const smallest = workshop.getByLabel("Smallest number");
    const largest = workshop.getByLabel("Largest number");
    await expect(smallest).toHaveValue("15");
    await expect(largest).toHaveValue("30");

    // Whole numbers only, from 15.1 to 15.9: nobody could answer. It is said beside the value.
    await smallest.fill("15.1");
    await largest.fill("15.9");
    await chair.getByRole("button", { name: "Review changes" }).click();
    const summary = chair.getByRole("alert").filter({ hasText: "Please fix the following" });
    await expect(summary).toBeFocused();
    const explained =
      "There is no whole number between this and the largest value beside it, so nobody could answer.";
    await expect(summary).toContainText(explained);
    await expect(workshop.locator(".field-error")).toHaveText(explained);
    await expect(smallest).toHaveAttribute("aria-invalid", "true");
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);

    // With a whole number between them the change can be reviewed. Taken back, nothing changed.
    await largest.fill("16");
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(chair.getByRole("heading", { name: "Review your changes" })).toBeFocused();
    await smallest.fill("15");
    await largest.fill("30");
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Nothing has been changed.");
  });

  test("a deadline that is refused says why at each of its three inputs", async () => {
    await openSettings(chair);
    const decisions = chair.getByRole("group", { name: "Decisions sent" });
    const date = decisions.getByLabel("Date");
    const before = await date.inputValue();
    // Decisions cannot be sent before the call has closed.
    await date.fill("2001-01-01");
    await chair.getByRole("button", { name: "Review changes" }).click();
    const summary = chair.getByRole("alert").filter({ hasText: "Please fix the following" });
    await expect(summary).toBeFocused();
    const why = "This must not be before the deadline above it.";
    await expect(summary).toContainText(`Decisions sent: ${why}`);
    await expect(decisions.locator(".field-error")).toHaveText(why);
    // Someone who comes back from the summary to correct it hears the reason at each input,
    // after the instant it makes (and, at the offset, before what an offset is).
    const error = await decisions.locator(".field-error").getAttribute("id");
    expect(error).toBeTruthy();
    for (const name of ["Date", "Time", "Offset from UTC"]) {
      const input = decisions.getByLabel(name);
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toHaveAttribute("aria-describedby", new RegExp(`(^| )${error}( |$)`));
      await expect(input).toHaveAccessibleDescription(new RegExp(`Conference time.*${why}`));
    }
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);

    // Taken back, nothing is wrong and nothing is described as wrong.
    await date.fill(before);
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Nothing has been changed.");
    await expect(date).not.toHaveAttribute("aria-invalid", "true");
    await expect(date).not.toHaveAccessibleDescription(new RegExp(why));
  });

  test("what is typed while a save is on its way stays in the form, to be reviewed in its turn", async () => {
    test.slow();
    await openSettings(chair);
    await chair.locator("summary", { hasText: FORMAT }).click();
    const most = formatSection(chair).getByLabel("Most words in the abstract");
    const people = formatSection(chair).getByLabel("Most people");
    await most.fill("310");
    await people.fill("7");
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(chair.getByRole("heading", { name: "Review your changes" })).toBeFocused();
    // Typed and not saved yet: this browser keeps it.
    const MOST = "submissionTypes.performance.abstract.maxWords";
    const PEOPLE = "submissionTypes.performance.team.max";
    const DAY = "deadlines.notification#date";
    await expect.poll(() => unsavedValues(chair)).toEqual({ [MOST]: "310", [PEOPLE]: "7" });

    // The save is held on its way to the server, as on a slow connection.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let left = () => {};
    const leaving = new Promise<void>((resolve) => {
      left = resolve;
    });
    const saving = `**/api/conferences/${CALL}/config`;
    await chair.route(saving, async (route) => {
      if (route.request().method() === "PUT") {
        left();
        await held;
      }
      await route.continue();
    });
    await chair.getByRole("button", { name: "Save changes" }).click();
    await leaving;

    // Meanwhile the form is still open: one of the values is typed again, and another is changed.
    await most.fill("320");
    const decisions = chair.getByRole("group", { name: "Decisions sent" });
    const date = decisions.getByLabel("Date");
    const before = await date.inputValue();
    const after = new Date(Date.parse(`${before}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    await date.fill(after);
    // The browser keeps what is in the form: what is being saved, and what was typed since.
    await expect
      .poll(() => unsavedValues(chair))
      .toEqual({ [MOST]: "320", [PEOPLE]: "7", [DAY]: after });
    release();

    // The page says what was saved and what was not, without taking the person out of the form.
    await expect(chair.getByRole("status")).toHaveText(
      "Settings saved. What you changed while they were being saved is still in the form, not saved yet.",
    );
    await expect(date).toBeFocused();
    await chair.unroute(saving);
    // What was reviewed is what was saved...
    const stored = (await (
      await chair.request.get(`/api/conferences/${CALL}/settings`)
    ).json()) as {
      config: {
        submissionTypes: { key: string; abstract: { maxWords: number }; team: { max: number } }[];
      };
    };
    const performance = stored.config.submissionTypes.find((type) => type.key === "performance");
    expect(performance?.abstract.maxWords).toBe(310);
    expect(performance?.team.max).toBe(7);
    // ...and what was typed since is still in the form, as changes to what was saved.
    await expect(most).toHaveValue("320");
    await expect(people).toHaveValue("7");
    await expect(date).toHaveValue(after);
    await expect(chair.getByText("Values changed and not saved yet: 2.")).toBeVisible();
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await chair.getByRole("button", { name: "Review changes" }).click();
    const review = chair.getByRole("region", { name: "Review your changes" });
    await expect(chair.getByRole("heading", { name: "Review your changes" })).toBeFocused();
    await expect(review.getByRole("listitem")).toHaveCount(2);
    await expect(review).toContainText("from “310” to “320”");
    await expect(review).toContainText("Decisions sent");
    // The browser now keeps only that: the value that was saved untouched is no longer in it.
    await expect.poll(() => unsavedValues(chair)).toEqual({ [MOST]: "320", [DAY]: after });
    // A reload brings exactly that back, on top of what was saved, and the page says so.
    await chair.reload();
    await expect(chair.getByText(RESTORED)).toBeVisible();
    await expect(most).toHaveValue("320");
    await expect(people).toHaveValue("7");
    await expect(date).toHaveValue(after);
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(review.getByRole("listitem")).toHaveCount(2);
    await expect(review).toContainText("from “310” to “320”");

    // Back as they were, for the tests that run beside this one. With everything saved, the
    // browser keeps nothing.
    await most.fill("300");
    await people.fill("6");
    await date.fill(before);
    await reviewAndSave(chair);
    await expect.poll(() => unsavedValues(chair)).toBeNull();
    await chair.goto(`/en/c/${CALL}`);
    await expect(listedFormat(chair)).toContainText("300 words at most");
  });

  test("settings that someone else changed meanwhile are reloaded, and what was typed stays", async () => {
    test.slow();
    await openSettings(chair);
    await chair.locator("summary", { hasText: FORMAT }).click();
    const most = formatSection(chair).getByLabel("Most words in the abstract");
    await most.fill("310");

    // Leaving with unsaved changes asks first; staying keeps them.
    let asked = "";
    chair.once("dialog", (dialog) => {
      asked = dialog.message();
      dialog.dismiss();
    });
    await chair.getByRole("navigation").getByRole("link", { name: "My submissions" }).click();
    await expect.poll(() => asked).toContain("unsaved changes");
    await expect(chair).toHaveURL(new RegExp(`/en/c/${CALL}/settings$`));
    await expect(most).toHaveValue("310");

    // Meanwhile the same conference is saved from somewhere else (here: this chair, by the API).
    const origin = new URL(chair.url()).origin;
    const elsewhere = async (teamMax: number) => {
      const got = await chair.request.get(`/api/conferences/${CALL}/settings`);
      const { config, token } = (await got.json()) as {
        token: string;
        config: { submissionTypes: { key: string; team: { max: number } }[] };
      };
      for (const type of config.submissionTypes) {
        if (type.key === "performance") type.team.max = teamMax;
      }
      const put = await chair.request.put(`/api/conferences/${CALL}/config`, {
        data: config,
        headers: { origin, "if-match": `"${token}"` },
      });
      expect(put.status()).toBe(200);
    };
    await elsewhere(7);

    await chair.getByRole("button", { name: "Review changes" }).click();
    const notice = chair.getByRole("alert").filter({ hasText: "Someone else has changed" });
    await expect(notice).toBeVisible();
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expectAccessibleInBothThemes(chair);
    await expectTouchTarget(notice.getByRole("button", { name: "Reload the settings" }));
    await notice.getByRole("button", { name: "Reload the settings" }).click();
    const status = chair.getByRole("status");
    await expect(status).toHaveText("The settings were reloaded. Review your changes again.");
    await expect(status).toBeFocused();
    await expect(notice).toHaveCount(0);
    // The other person's value arrived, and this person's unsaved one is still in the form.
    await expect(formatSection(chair).getByLabel("Most people")).toHaveValue("7");
    await expect(most).toHaveValue("310");
    await chair.getByRole("button", { name: "Review changes" }).click();
    const review = chair.getByRole("region", { name: "Review your changes" });
    await expect(review.getByRole("listitem")).toHaveCount(1);
    await expect(review).toContainText("from “300” to “310”");
    await expect(chair.getByRole("button", { name: "Save changes" })).toBeVisible();

    // What is typed and not saved is kept in this browser, as in the proposal editor. After a
    // reload (or a tab the phone closed) it is back in the form, in a section that is open, and
    // the page says so.
    await expect.poll(() => unsavedKeys(chair)).toHaveLength(1);
    await chair.reload();
    await expect(chair.getByText(RESTORED)).toBeVisible();
    await expect(most).toBeVisible();
    await expect(most).toHaveValue("310");
    await expect(chair.getByText("Values changed and not saved yet: 1.")).toBeVisible();
    const discard = chair.getByRole("button", { name: "Discard unsaved changes" });
    await expectTouchTarget(discard);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    // It is still only typed: the review comes before any save, and shows it against what is stored.
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(review.getByRole("listitem")).toHaveCount(1);
    await expect(review).toContainText("from “300” to “310”");

    // Discarding puts the saved settings back and keeps nothing: the form is as it was, and so,
    // below, is the value changed elsewhere.
    await discard.click();
    await expect(chair.getByRole("status")).toHaveText("Unsaved changes discarded.");
    await expect(chair.getByRole("status")).toBeFocused();
    await expect(most).toHaveValue("300");
    await expect(chair.getByText(RESTORED)).toHaveCount(0);
    await expect.poll(() => unsavedKeys(chair)).toEqual([]);
    await chair.reload();
    await expect(
      chair.getByRole("heading", { level: 1, name: "Conference settings" }),
    ).toBeVisible();
    await expect(chair.getByText(RESTORED)).toHaveCount(0);
    await elsewhere(6);
  });

  test("a chair writes guidelines for a pool's reviewers and renames a criterion, and puts both back", async () => {
    test.slow();
    // Whatever the call says now: the test reads it, changes two texts and puts them back.
    const before = await stored(chair, CALL);
    const pool = before.config.reviewPools[0];
    const criterion = pool?.criteria[0];
    if (!pool || !criterion) throw new Error("the call has no review pool with a criterion");
    const poolName = pool.name.en ?? "";
    const label = criterion.label.en ?? "";
    const was = pool.guidelines?.en ?? "";
    const reviewed = before.config.submissionTypes.filter((type) => type.reviewPool === pool.key);

    await openSettings(chair);
    await expect(
      chair.getByRole("heading", { level: 2, name: "Review", exact: true }),
    ).toBeVisible();

    // A pool's values are in its own section, closed until asked for. Its first line says which
    // formats they apply to.
    await expect(chair.getByLabel("Guidelines for reviewers (English)").first()).toBeHidden();
    const section = await openPool(chair, poolName);
    await expect(section.locator("p.meta").first()).toContainText(
      `This pool reviews these formats: ${reviewed.map((type) => type.name.en).join(", ")}.`,
    );

    // How authors appear to reviewers is three sentences to choose from, the stored one chosen.
    // It is only read here.
    const modes = section.getByRole("group", { name: "How authors appear to reviewers" });
    await expect(modes.getByRole("radio")).toHaveCount(3);
    for (const sentence of Object.values(SHOWN)) {
      await expect(modes.getByRole("radio", { name: sentence, exact: true })).toBeVisible();
    }
    await expect(
      modes.getByRole("radio", { name: SHOWN[pool.blindMode], exact: true }),
    ).toBeChecked();
    await expectTouchTarget(modes.locator("label.choice").first());
    // The one thing about this choice that cannot be undone is said under it.
    await expect(modes).toContainText(
      "An anonymized review stays anonymized once a reviewer has been assigned, even if they are removed again: after that, it can no longer be changed to show the authors.",
    );
    await expect(section.getByLabel("Reviews per proposal")).toHaveValue(
      String(pool.reviewsPerSubmission),
    );

    // The guidelines: a hint says where the text will appear, and the box is described by it.
    const guidelines = section.getByLabel("Guidelines for reviewers (English)");
    await expect(guidelines).toHaveValue(was);
    await expect(guidelines).toHaveAccessibleDescription(
      /^Optional\. This pool's reviewers see this text above every proposal assigned to them/,
    );
    await expectTouchTarget(guidelines);
    const text = "Read the whole proposal before you score it.\n\nSay what would make it stronger.";
    await guidelines.fill(text);

    // A criterion: its label in each language, and the two ends of its scale.
    const group = section.getByRole("group", { name: `Criterion: ${label}` });
    const labelled = group.getByLabel("Label (English)");
    await expect(labelled).toHaveValue(label);
    await expect(group.getByLabel("Smallest score")).toHaveValue(String(criterion.min));
    await expect(group.getByLabel("Largest score")).toHaveValue(String(criterion.max));
    const renamed = `${label} (browser test)`;
    await labelled.fill(renamed);
    await expect(chair.getByText("Values changed and not saved yet: 2.")).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 360, height: 740 });
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 390, height: 844 });

    // Both are reviewed, by name, before anything is saved.
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await chair.getByRole("button", { name: "Review changes" }).click();
    const review = chair.getByRole("region", { name: "Review your changes" });
    await expect(chair.getByRole("heading", { name: "Review your changes" })).toBeFocused();
    await expect(review.getByRole("listitem")).toHaveCount(2);
    await expect(review).toContainText(`${poolName} · Guidelines for reviewers (English)`);
    await expect(review).toContainText("Read the whole proposal before you score it.");
    await expect(review).toContainText(`${poolName} · ${label} · Label (English)`);
    await expect(review).toContainText(`from “${label}” to “${renamed}”`);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.getByRole("button", { name: "Save changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Settings saved.");
    await expect(chair.getByRole("status")).toBeFocused();

    // After a reload they are what the conference holds: nothing is left unsaved in the browser,
    // and the text has its line breaks.
    await chair.reload();
    await expect(
      chair.getByRole("heading", { level: 1, name: "Conference settings" }),
    ).toBeVisible();
    await expect(chair.getByText(RESTORED)).toHaveCount(0);
    await openPool(chair, poolName);
    await expect(guidelines).toHaveValue(text);
    await expect(
      section.getByRole("group", { name: `Criterion: ${renamed}` }).getByLabel("Label (English)"),
    ).toHaveValue(renamed);
    const saved = (await stored(chair, CALL)).config.reviewPools[0];
    expect(saved?.guidelines).toEqual({ ...pool.guidelines, en: text });
    expect(saved?.criteria[0]?.label.en).toBe(renamed);

    // Back exactly as they were, for the tests that run beside this one.
    await guidelines.fill(was);
    await labelled.fill(label);
    await reviewAndSave(chair);
    const after = await stored(chair, CALL);
    expect(after.config.reviewPools).toEqual(before.config.reviewPools);
    expect(after.token).toBe(before.token);
    await expect.poll(() => unsavedValues(chair)).toBeNull();
  });

  test("a chair adds to the invitation, the front page says it, and it is put back", async () => {
    test.slow();
    // Whatever the call says now: the test reads it, adds a sentence to the end of the Spanish
    // invitation and takes it away again.
    const before = await stored(chair, CALL);
    const english = before.config.invitation?.en ?? "";
    const was = before.config.invitation?.es ?? "";
    const way = before.config.contributionGroups[0];
    if (!english || !was || !way) throw new Error("the call has no invitation to reword");
    const added = `${was} (Frase de prueba.)`;

    await openSettings(chair);
    // The invitation's two texts are with the conference's own, in each of its languages. A
    // hint says where each appears, and the boxes are described by it.
    const invitation = chair.getByRole("group", { name: "Invitation", exact: true });
    const spanish = invitation.getByLabel("Invitation (Español)");
    await expect(invitation.getByLabel("Invitation (English)")).toHaveValue(english);
    await expect(spanish).toHaveValue(was);
    await expect(spanish).toHaveAccessibleDescription(
      /^Optional\. A short paragraph that says what work the call welcomes\. The front page and the conference page begin with it/,
    );
    await expectTouchTarget(spanish);
    const apart = chair.getByRole("group", { name: "What sets this edition apart", exact: true });
    const line = apart.getByLabel("What sets this edition apart (English)");
    await expect(line).toHaveValue(before.config.distinction?.en ?? "");
    await expect(line).toHaveAccessibleDescription(
      /^Optional\. One line, shown with the dates and the place/,
    );

    // The ways to contribute: each existing one in its own section, closed until asked for.
    // Its first line says which formats it leads to; which those are is not offered here.
    // These are only read.
    await expect(
      chair.getByRole("heading", { level: 2, name: "Ways to contribute", exact: true }),
    ).toBeVisible();
    await expect(
      chair.getByText(
        "The front page and the conference page list these under “Ways to contribute”, each with a link to its formats. Adding or removing one, or moving a format to another, is done by importing a configuration.",
      ),
    ).toBeVisible();
    const section = await openPool(chair, way.name.en ?? "");
    const formats = way.formats.flatMap((key) => {
      const format = before.config.submissionTypes.find((type) => type.key === key);
      return format?.name.en ? [format.name.en] : [];
    });
    await expect(section.locator("p.meta").first()).toHaveText(
      `It leads to these formats: ${formats.join(", ")}.`,
    );
    await expect(section.getByLabel("Name (English)")).toHaveValue(way.name.en ?? "");
    await expect(section.getByLabel("What it includes (Español)")).toHaveValue(
      way.summary.es ?? "",
    );
    await expect(section.getByRole("textbox")).toHaveCount(4);

    await spanish.fill(added);
    await expect(chair.getByText("Values changed and not saved yet: 1.")).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 360, height: 740 });
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 390, height: 844 });

    // It is reviewed, by name, before anything is saved.
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await chair.getByRole("button", { name: "Review changes" }).click();
    const review = chair.getByRole("region", { name: "Review your changes" });
    await expect(chair.getByRole("heading", { name: "Review your changes" })).toBeFocused();
    await expect(review.getByRole("listitem")).toHaveCount(1);
    await expect(review).toContainText("Invitation (Español)");
    await expect(review).toContainText("(Frase de prueba.)");
    await chair.getByRole("button", { name: "Save changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Settings saved.");
    expect((await stored(chair, CALL)).config.invitation).toEqual({
      ...before.config.invitation,
      es: added,
    });

    // The front page says it: in Spanish as the invitation, in English as its echo. The
    // English one is as it was.
    await chair.goto("/es/");
    await expect(chair.locator(".invitation-text")).toContainText(added);
    await expect(chair.locator(".invitation-text .echo")).toHaveText(english);
    await chair.goto("/en/");
    await expect(chair.locator(".invitation-text")).toContainText(english);
    await expect(chair.locator(".invitation-text .echo")).toHaveText(added);
    // The call's own page begins with the same invitation. Its chair has the way to the
    // submissions beside the main action there.
    await chair.goto(`/en/c/${CALL}`);
    await expect(chair.locator(".invitation-text .echo")).toHaveText(added);
    const actions = chair.locator(".invitation-lead .actions");
    await expect(actions.getByRole("link", { name: "Start a proposal" })).toBeVisible();
    await expectTouchTarget(actions.getByRole("link", { name: "Manage submissions" }));
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);

    // Back exactly as it was, for the tests that run beside this one.
    await openSettings(chair);
    await chair
      .getByRole("group", { name: "Invitation", exact: true })
      .getByLabel("Invitation (Español)")
      .fill(was);
    await reviewAndSave(chair);
    const after = await stored(chair, CALL);
    expect(after.config.invitation).toEqual(before.config.invitation);
    expect(after.config.contributionGroups).toEqual(before.config.contributionGroups);
    expect(after.token).toBe(before.token);
    await expect.poll(() => unsavedValues(chair)).toBeNull();
    await chair.goto("/es/");
    await expect(chair.locator(".invitation-text")).toContainText(was);
    await expect(chair.locator(".invitation-text")).not.toContainText("(Frase de prueba.)");
  });

  test("a chair rewords an email, sees it as it would be sent, and goes back to the standard text", async () => {
    test.slow();
    // The email reworded and saved here is the Portuguese one. Emails are offered in English,
    // Spanish and Portuguese whatever the call's own languages are; the other tests invite in
    // English and Spanish only, and none reads this notice in any language.
    // The standard text and the sample name below are the app's own. Any wording the call has
    // of its own is read first: the test takes the call as it finds it and puts it back.
    const DELETED = "Notice to people invited to a deleted draft";
    const INVITATION = "Invitation to a proposal";
    const NAMES = { en: "English", es: "Español", pt: "Português" };
    const lang = "pt";
    const L = {
      name: NAMES[lang],
      subject: "{conference}: um convite foi cancelado",
      body: "Foi eliminado um rascunho de proposta para {conference} em que constava. Não precisa de fazer nada.",
      invitation: "{owner} incluiu-o com o papel de {role} numa proposta",
      owner: "Ana Exemplo",
      roles: "autoria principal · apresentação · coautoria · painelista · moderação",
    };
    const before = await stored(chair, CALL);
    const own = before.config.messages?.draft_deleted;
    const was = {
      subject: own?.subject?.[lang] ?? L.subject,
      body: own?.body?.[lang] ?? L.body,
    };
    /** A text as the review names it: one the app supplies is "the standard text". */
    const named = (text: string) =>
      text === L.subject || text === L.body ? "the standard text" : text;
    // The conference's title as mail in Portuguese gives it: in Portuguese where the call has
    // written one, otherwise in its main language.
    const title = before.config.title;
    const regional = Object.keys(title).find((key) => key.startsWith(`${lang}-`));
    const conference =
      title[lang] ?? (regional ? title[regional] : title[before.config.defaultLanguage]) ?? "";
    // The three languages, the call's main one first.
    const main = before.config.defaultLanguage.toLowerCase().split("-")[0];
    const order = (["en", "es", "pt"] as const)
      .filter((l) => l === main)
      .concat((["en", "es", "pt"] as const).filter((l) => l !== main));

    await openSettings(chair);
    await expect(
      chair.getByRole("heading", { level: 2, name: "Emails", exact: true }),
    ).toBeVisible();
    // What the section is for, which text a person gets, who can read it, and what is not
    // offered.
    await expect(
      chair.getByText(
        "Each box shows the text that is sent: the standard text, until you change it.",
      ),
    ).toBeVisible();
    await expect(
      chair.getByText(
        "All three languages are here, whichever of them the conference has, because each person gets the email in their own language: someone can be invited in Portuguese to a conference held in English and Spanish. A language you have not changed keeps the standard text. These texts are not private: like the rest of these settings, anyone who can see the conference can read them. The sign-in email is the same for everyone and cannot be changed here.",
      ),
    ).toBeVisible();

    // Each email is in its own section, closed until asked for. Its first line says when it
    // is sent and to whom, and a list says what its texts may name.
    await expect(chair.getByLabel(`Subject (${L.name})`).first()).toBeHidden();
    const section = await openPool(chair, DELETED);
    await expect(section.locator("p.meta").first()).toHaveText(
      "Sent to people who were invited to a draft and have not answered, when its owner deletes it. It cannot name the proposal: they have not agreed to anything.",
    );
    const names = section.locator(".placeholders");
    await expect(names.locator("dt")).toHaveText(["{conference}"]);
    await expect(names.locator("dd")).toHaveText(["the conference's title"]);

    // Every email has its three languages, each in a group of its own.
    await expect(section.locator("fieldset > legend")).toHaveText(order.map((l) => NAMES[l]));
    // The boxes show what is sent now: the standard text, unless the call has its own.
    const group = section.getByRole("group", { name: L.name });
    const subject = group.getByLabel(`Subject (${L.name})`);
    const body = group.getByLabel(`Text (${L.name})`);
    await expect(subject).toHaveValue(was.subject);
    await expect(body).toHaveValue(was.body);
    // Each box is described by the whole list: the sentence, and the words it lists.
    await expect(subject).toHaveAccessibleDescription(
      /^You can put these words, with their braces, in the subject and in the text\. Each is replaced when the email is sent:\s*\{conference\}\s*the conference's title$/,
    );
    await expectTouchTarget(subject);
    const useStandard = group.getByRole("button", { name: "Use the standard text" });
    await expectTouchTarget(useStandard);

    // The email as it would be sent is under the boxes, filled with made-up values, and
    // follows what is typed.
    const preview = group.getByRole("figure");
    await expect(preview).toContainText(
      "The email as it would be sent, with made-up names and titles:",
    );
    const reworded = {
      subject: "O seu convite para {conference} foi cancelado",
      body: "Olá:\n\no rascunho para {conference} para o qual foi convidado já não existe.\n\nNão precisa de fazer nada.",
    };
    // The subject arrives as a paste often does, with characters nobody can see: a byte-order
    // mark, and a mark that would make what follows read backwards. They are taken out: the
    // email shown under the boxes, the review and what is saved have the words only.
    await subject.fill(`\uFEFF${reworded.subject.replace("para", "\u202Epara")}`);
    await body.fill(reworded.body);
    await expect(preview.locator(".email-subject")).toHaveText(
      `O seu convite para ${conference} foi cancelado`,
    );
    await expect(preview.locator(".email-body")).toHaveText(
      reworded.body.replaceAll("{conference}", conference),
    );
    // Its line breaks are kept, as in the mail.
    await expect(preview.locator(".email-body")).toHaveCSS("white-space", "pre-wrap");
    await expect(group.getByText("This is not the standard text.")).toBeVisible();
    await expect(useStandard).not.toHaveAttribute("aria-disabled", "true");
    await expect(chair.getByText("Values changed and not saved yet: 2.")).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 360, height: 740 });
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 390, height: 844 });

    // The invitation is only tried, never saved: other tests read the one that is sent. Its
    // list says which words the app supplies, and what the text cannot do without.
    const invitation = await openPool(chair, INVITATION);
    const invited = invitation.locator(".placeholders");
    await expect(invited.locator("dt")).toHaveText([
      "{owner}",
      "{role}",
      "{format}",
      "{conference}",
      "{link}",
    ]);
    await expect(invited).toContainText(`${L.name}: ${L.roles}`);
    await expect(invited.locator("dd").first()).toContainText("It cannot go in the subject.");
    await expect(invited.locator("dd").first()).toContainText(
      "It has to be a word of its own: only brackets, quotation marks and the punctuation that ends a phrase may touch it.",
    );
    await expect(invited.locator("dd").last()).toContainText(
      "The text must contain it, and it cannot go in the subject.",
    );
    const tried = invitation.getByRole("group", { name: L.name });
    const itsSubject = tried.getByLabel(`Subject (${L.name})`);
    const itsBody = tried.getByLabel(`Text (${L.name})`);
    const itsWas = { subject: await itsSubject.inputValue(), body: await itsBody.inputValue() };
    await itsSubject.fill("Join {owner}: {link} {name}");
    await itsBody.fill("Please join us, {owner} says.");
    // What cannot be filled stays as it is written, in the preview as in the mail.
    await expect(tried.getByRole("figure").locator(".email-subject")).toHaveText(
      "Join {owner}: {link} {name}",
    );
    await expect(tried.getByRole("figure").locator(".email-body")).toHaveText(
      `Please join us, ${L.owner} says.`,
    );

    // The review says what is wrong with each text, in the summary and beside it.
    await chair.getByRole("button", { name: "Review changes" }).click();
    const summary = chair.getByRole("alert").filter({ hasText: "Please fix the following" });
    await expect(summary).toBeFocused();
    const unknown =
      "This email has nothing to put in place of {name}. Use only the words in braces listed above, or remove the braces.";
    const inSubject = "The subject cannot contain {owner}, {link}. Only the text can.";
    const missing = "The text must contain {link}.";
    await expect(summary.getByRole("listitem")).toHaveText([
      `${INVITATION} · Subject (${L.name}): ${unknown}`,
      `${INVITATION} · Subject (${L.name}): ${inSubject}`,
      `${INVITATION} · Text (${L.name}): ${missing}`,
    ]);
    await expect(tried.locator(".field-error")).toHaveText([`${unknown} ${inSubject}`, missing]);
    await expect(itsSubject).toHaveAttribute("aria-invalid", "true");
    await expect(itsBody).toHaveAttribute("aria-invalid", "true");
    await expect(itsBody).toHaveAccessibleDescription(/The text must contain \{link\}\.$/);
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    // The summary's link leads to the text.
    await summary.getByRole("link").last().click();
    await expect(itsBody).toBeFocused();

    // A text that would build a link around the owner's name is refused beside it: the name
    // has to stay a word of its own.
    await itsSubject.fill(itsWas.subject);
    await itsBody.fill("See https://{owner}.example\n\n{link}");
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(summary).toBeFocused();
    const ownWord =
      "{owner} stands for a name a person typed, so it has to be a word of its own. Put a space before and after it. Only brackets, quotation marks and the punctuation that ends a phrase may touch it: anything else could turn the name into part of a link or an address.";
    await expect(summary.getByRole("listitem")).toHaveText([
      `${INVITATION} · Text (${L.name}): ${ownWord}`,
    ]);
    await expect(tried.locator(".field-error")).toHaveText(ownWord);

    // An emptied text is not quietly the standard text again: it is refused, and says how to
    // get the standard text back.
    await itsBody.fill("");
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(summary).toBeFocused();
    await expect(summary.getByRole("listitem")).toHaveCount(1);
    await expect(tried.locator(".field-error")).toHaveText(
      "Write the text, or choose “Use the standard text”.",
    );
    // The button says which email and language it is for. It would lose what was typed here
    // and not saved, so it asks first; told no, it changes nothing.
    const backToStandard = tried.getByRole("button", {
      name: `Use the standard text: ${INVITATION}, ${L.name}`,
    });
    let asked = "";
    chair.once("dialog", (dialog) => {
      asked = dialog.message();
      dialog.dismiss();
    });
    await backToStandard.click();
    await expect
      .poll(() => asked)
      .toBe(
        "Replace what you typed with the standard text? What you typed in these two boxes and have not saved will be lost.",
      );
    await expect(itsBody).toHaveValue("");
    chair.once("dialog", (dialog) => dialog.accept());
    await backToStandard.click();
    // The button stays, with focus on it, and the boxes hold the standard text again.
    await expect(backToStandard).toBeFocused();
    await expect(backToStandard).toHaveAttribute("aria-disabled", "true");
    await expect(tried.getByText("This is the standard text.")).toBeVisible();
    expect(await itsBody.inputValue()).toContain(L.invitation);
    // (Had the call a wording of its own for the invitation, it goes back in, unchanged.)
    await itsSubject.fill(itsWas.subject);
    await itsBody.fill(itsWas.body);
    await expect(chair.getByText("Values changed and not saved yet: 2.")).toBeVisible();

    // Only the notice about a deleted draft is left to review: both texts, by name, from what
    // they were to the new ones, line breaks kept.
    await chair.getByRole("button", { name: "Review changes" }).click();
    const review = chair.getByRole("region", { name: "Review your changes" });
    await expect(chair.getByRole("heading", { name: "Review your changes" })).toBeFocused();
    await expect(review.getByRole("listitem")).toHaveText([
      `${DELETED} · Subject (${L.name})from “${named(was.subject)}” to “${reworded.subject}”`,
      `${DELETED} · Text (${L.name})from “${named(was.body)}” to “${reworded.body}”`,
    ]);
    await expect(review.getByRole("listitem").last()).toHaveCSS("white-space", "pre-wrap");
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.getByRole("button", { name: "Save changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Settings saved.");

    // The conference now holds those two texts, by path, and nothing else is new.
    const saved = await stored(chair, CALL);
    expect(saved.config.messages).toEqual({
      ...before.config.messages,
      draft_deleted: {
        ...own,
        subject: { ...own?.subject, [lang]: reworded.subject },
        body: { ...own?.body, [lang]: reworded.body },
      },
    });
    // After a reload they are in the boxes, and nothing is left unsaved in the browser.
    await chair.reload();
    await expect(
      chair.getByRole("heading", { level: 1, name: "Conference settings" }),
    ).toBeVisible();
    await expect(chair.getByText(RESTORED)).toHaveCount(0);
    await openPool(chair, DELETED);
    await expect(subject).toHaveValue(reworded.subject);
    await expect(body).toHaveValue(reworded.body);
    await expect(group.getByText("This is not the standard text.")).toBeVisible();

    // "Use the standard text" puts the standard text back in both boxes, and the email shown
    // under them is the standard one again. Nothing typed is lost by it (what it replaces is
    // saved), so it does not ask.
    await useStandard.click();
    await expect(useStandard).toBeFocused();
    await expect(subject).toHaveValue(L.subject);
    await expect(body).toHaveValue(L.body);
    await expect(group.getByText("This is the standard text.")).toBeVisible();
    await expect(preview.locator(".email-subject")).toHaveText(
      L.subject.replace("{conference}", conference),
    );
    // Saved, the conference's own text is gone. (Had the call held one before this test, that
    // one goes back instead.)
    await subject.fill(was.subject);
    await body.fill(was.body);
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(chair.getByRole("heading", { name: "Review your changes" })).toBeFocused();
    await expect(review.getByRole("listitem")).toHaveText([
      `${DELETED} · Subject (${L.name})from “${reworded.subject}” to “${named(was.subject)}”`,
      `${DELETED} · Text (${L.name})from “${reworded.body}” to “${named(was.body)}”`,
    ]);
    await chair.getByRole("button", { name: "Save changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Settings saved.");
    await expect(chair.getByRole("status")).toBeFocused();

    // Exactly as it was, for the tests that run beside this one: no wording is left behind,
    // not even an empty place for one.
    const after = await stored(chair, CALL);
    expect(after.config).toEqual(before.config);
    expect(JSON.stringify(after.config)).toBe(JSON.stringify(before.config));
    expect(after.token).toBe(before.token);
    await expect.poll(() => unsavedValues(chair)).toBeNull();
  });

  test("an agreement's words change only with a new version, and the review says what that does", async () => {
    test.slow();
    // Nothing here is saved. Whatever the call's first agreement says is read first, changed
    // in the form as far as the review step, and taken back.
    const before = await stored(chair, CALL);
    const agreement = before.config.agreements[0];
    if (!agreement) throw new Error("the call has no agreement");
    const name = agreement.title.en ?? "";
    const was = { url: agreement.url ?? "", text: agreement.text?.en ?? "" };

    await openSettings(chair);
    await expect(
      chair.getByRole("heading", { level: 2, name: "Agreements", exact: true }),
    ).toBeVisible();
    await expect(
      chair.getByText(
        "People accept these when they submit a proposal or confirm an invitation. The app records which version of each agreement each person accepted.",
      ),
    ).toBeVisible();

    // Each agreement is in its own section, closed until asked for. Its first lines say what
    // a new version is for and what it does.
    const summary = chair
      .locator("summary")
      .filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
    await expectTouchTarget(summary);
    const section = chair.locator("details").filter({ has: summary });
    await expect(section.getByLabel("Version")).toBeHidden();
    await summary.click();
    await expect(section.locator("p.meta").first()).toHaveText(
      "If you change what this agreement says (its title, its text or its link), give it a new version. With a new version, everyone who submits a proposal or confirms an invitation from then on accepts the new one. What people have already accepted stays recorded against the old version. Nobody is emailed, and proposals already submitted are not affected.",
    );

    // Its title and its text in each language of the conference, its link and its version.
    const title = section.getByLabel("Title (English)");
    const text = section.getByRole("group", { name: "Text" }).getByLabel("Text (English)");
    const link = section.getByLabel("Link");
    const version = section.getByLabel("Version");
    await expect(title).toHaveValue(name);
    await expect(text).toHaveValue(was.text);
    await expect(text).toHaveAccessibleDescription(
      /^Optional if the agreement has a link\. People read this under the title when they accept/,
    );
    await expect(link).toHaveValue(was.url);
    await expect(link).toHaveAccessibleDescription(
      "Optional if the agreement has a text. A page people can open to read the agreement. It starts with https://",
    );
    await expect(version).toHaveValue(agreement.version);
    const versionHint =
      "This names what people accept. Change it whenever the title, the text or the link changes. Anything different from the saved version will do: a date such as 2026-12, or a number.";
    await expect(version).toHaveAccessibleDescription(versionHint);
    await expectTouchTarget(version);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 360, height: 740 });
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 390, height: 844 });

    // The title is changed and the version is not: the review refuses it beside the version,
    // which is the value to change, and offers no save.
    const revised = `${name} (revised)`;
    await title.fill(revised);
    await expect(chair.getByText("Values changed and not saved yet: 1.")).toBeVisible();
    await chair.getByRole("button", { name: "Review changes" }).click();
    const problems = chair.getByRole("alert").filter({ hasText: "Please fix the following" });
    await expect(problems).toBeFocused();
    const why =
      "You changed what this agreement says. People accepted the old words under this version, so enter a new version.";
    await expect(problems.getByRole("listitem")).toHaveText([`${name} · Version: ${why}`]);
    await expect(section.locator(".field-error")).toHaveText(why);
    await expect(version).toHaveAttribute("aria-invalid", "true");
    await expect(version).toHaveAccessibleDescription(`${versionHint} ${why}`);
    await expect(title).not.toHaveAttribute("aria-invalid", "true");
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(chair.getByRole("region", { name: "Review your changes" })).toHaveCount(0);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    // The summary's link leads to the version.
    await problems.getByRole("link").click();
    await expect(version).toBeFocused();

    // A link has to be an https address, said beside it.
    const next = `${agreement.version}-next`;
    await version.fill(next);
    await link.fill("http://example.org/agreement");
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(problems).toBeFocused();
    await expect(problems.getByRole("listitem")).toHaveText([
      `${name} · Link: Enter a web address that starts with https://`,
    ]);
    await link.fill(was.url);

    // With a new version the change can be reviewed: both values by name, and what a new
    // version does, before anything is saved. It is not saved here.
    await chair.getByRole("button", { name: "Review changes" }).click();
    const review = chair.getByRole("region", { name: "Review your changes" });
    await expect(chair.getByRole("heading", { name: "Review your changes" })).toBeFocused();
    await expect(review.getByRole("listitem")).toHaveText([
      `${name} · Title (English)from “${name}” to “${revised}”`,
      `${name} · Versionfrom “${agreement.version}” to “${next}”`,
    ]);
    await expect(review.locator("p.notice")).toHaveText(
      `New version of “${name}”. Everyone who submits a proposal or confirms an invitation from now on accepts the new version. What people have already accepted stays recorded against the old one. Nobody is emailed, and proposals already submitted are not affected. Someone who has a proposal or an invitation open right now has to reload the page before they can accept.`,
    );
    await expectTouchTarget(chair.getByRole("button", { name: "Save changes" }));
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);

    // A new version alone is a change too, and says the same.
    await title.fill(name);
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(review.getByRole("listitem")).toHaveText([
      `${name} · Versionfrom “${agreement.version}” to “${next}”`,
    ]);
    await expect(review.locator("p.notice")).toContainText(`New version of “${name}”.`);

    // Taken back, nothing has changed, nothing is kept in the browser, and the call is as it
    // was for the tests that accept its agreements beside this one.
    await version.fill(agreement.version);
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Nothing has been changed.");
    await expect.poll(() => unsavedKeys(chair)).toEqual([]);
    const after = await stored(chair, CALL);
    expect(after.token).toBe(before.token);
    expect(after.config.agreements).toEqual(before.config.agreements);
  });

  test("showing the authors of an anonymized review is refused beside the choice once reviewers are assigned", async () => {
    // The sandbox is in review, and its proposals have reviewers. Nothing here is saved: the
    // review refuses the change, and no save is offered.
    const SANDBOX = "sandbox";
    const before = await stored(chair, SANDBOX);
    const pool = before.config.reviewPools.find((x) => x.blindMode === "double");
    if (!pool) throw new Error("the sandbox has no pool reviewed anonymized");
    const poolName = pool.name.en ?? "";

    await chair.goto(`/en/c/${SANDBOX}/settings`);
    await expect(
      chair.getByRole("heading", { level: 1, name: "Conference settings" }),
    ).toBeVisible();

    // A pool whose format has a mode of its own says so, in the line under its name; and the
    // guidelines seeded for the sandbox are there to be read and changed.
    const own = before.config.submissionTypes.find((type) => type.blindMode === "double");
    const ownPool = before.config.reviewPools.find((x) => x.key === own?.reviewPool);
    if (!own || !ownPool) throw new Error("the sandbox has no format with a mode of its own");
    const other = await openPool(chair, ownPool.name.en ?? "");
    await expect(other.locator("p.meta").first()).toContainText(
      `${own.name.en} is always anonymized, whatever is chosen below.`,
    );
    const seeded = before.config.reviewPools.find((x) => x.guidelines);
    if (!seeded?.guidelines) throw new Error("the sandbox has no guidelines for reviewers");
    await expect(
      (await openPool(chair, seeded.name.en ?? "")).getByLabel(
        "Guidelines for reviewers (English)",
      ),
    ).toHaveValue(seeded.guidelines.en ?? "");

    const section = await openPool(chair, poolName);
    const modes = section.getByRole("group", { name: "How authors appear to reviewers" });
    const anonymized = modes.getByRole("radio", { name: SHOWN.double, exact: true });
    await expect(anonymized).toBeChecked();
    await modes.getByRole("radio", { name: SHOWN.single, exact: true }).check();
    await chair.getByRole("button", { name: "Review changes" }).click();

    // The reason is said in the summary, which takes focus, and beside the choice.
    const summary = chair.getByRole("alert").filter({ hasText: "Please fix the following" });
    await expect(summary).toBeFocused();
    const why =
      "Reviewers have already been assigned to proposals that are reviewed anonymized here. They and the authors were told that the review is anonymized, so the authors cannot be shown now.";
    await expect(summary).toContainText(`${poolName} · How authors appear to reviewers: ${why}`);
    await expect(modes.locator(".field-error")).toHaveText(why);
    for (const radio of await modes.getByRole("radio").all()) {
      await expect(radio).toHaveAttribute("aria-invalid", "true");
      // Each choice says the rule, then why this change is refused.
      await expect(radio).toHaveAccessibleDescription(
        `An anonymized review stays anonymized once a reviewer has been assigned, even if they are removed again: after that, it can no longer be changed to show the authors. ${why}`,
      );
    }
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(chair.getByRole("region", { name: "Review your changes" })).toHaveCount(0);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    // The summary's link leads to the choice.
    await summary.getByRole("link").click();
    await expect(modes).toBeFocused();

    // Taken back, nothing has changed, nothing is kept in the browser, and the sandbox is as it was.
    await anonymized.check();
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Nothing has been changed.");
    await expect.poll(() => unsavedKeys(chair)).toEqual([]);
    expect((await stored(chair, SANDBOX)).token).toBe(before.token);
  });

  /*
   * People and invitations (spec 03, §1.2). They are here because this file has a chair signed
   * in: nobody signs in below. An invitee answers by the emailed link, which needs no account.
   * Each test invites addresses of its own, and leaves the call's roles as it found them.
   */

  /** The call's People page, reached as a chair reaches it. */
  async function openPeople(page: Page) {
    await page.goto(`/en/c/${CALL}/manage`);
    await page.getByRole("link", { name: "People", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/en/c/${CALL}/people$`));
    // A new page: its heading takes focus.
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeFocused();
  }
  /** One part of the People page, by its heading. */
  const part = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
  /** The row of one invitation or one person, by the address on it. */
  const rowOf = (within: Locator, email: string) =>
    within.getByRole("listitem").filter({ hasText: email });
  /** The latest invitation to a role mailed to an address, and the link in it. */
  async function invitationMail(request: APIRequestContext, email: string) {
    const res = await request.get(`/api/_test/outbox/latest?to=${encodeURIComponent(email)}`);
    const mail = (await res.json()) as { subject: string; text: string };
    const link = /https?:\/\/\S+\/role-invitation#token=\S+/.exec(mail.text)?.[0] ?? "";
    expect(link).not.toBe("");
    return { ...mail, link };
  }
  /** Fill in the invitation form and send it. The role and the pools stay as they are. */
  async function sendInvitation(page: Page, email: string, name?: string) {
    await page.getByLabel("Email address *").fill(email);
    await page.getByLabel("Name (optional)").fill(name ?? "");
    await page.getByRole("button", { name: "Send the invitation" }).click();
  }

  test("a chair invites a reviewer by email, who accepts by the link; the chair sees them under the committee, and removes them", async ({
    browser,
    request,
  }) => {
    test.slow();
    const email = "e2e-people-reviewer@example.org";
    const typed = "Typed By The Chair";
    const own = "Rita Reviewer-Example";
    // The call's committees (its review pools) and its title, whatever they are called.
    const { config } = await stored(chair, CALL);
    const pool = config.reviewPools[0]?.name.en ?? "";
    const title = config.title.en ?? "";

    await openPeople(chair);
    // The page says what it is, and what each part of it is for.
    await expect(
      chair.getByText(
        "This page shows who holds a role at this conference, and the invitations that nobody has accepted. A person gets a role by accepting an invitation sent from here. You can take a role away again.",
      ),
    ).toBeVisible();
    const inviting = part(chair, "Invite someone");
    await expect(
      inviting.getByText(
        "The person gets an email with a link. Nothing changes until they open the link and accept: then the address you typed gets the role, whoever opened the link. The link works for 30 days. You invite one address at a time.",
      ),
    ).toBeVisible();
    // The chair is listed as a chair, marked as themselves, with no way to remove their own role.
    const chairs = part(chair, "Chairs");
    const me = rowOf(chairs, "chair@example.org");
    await expect(me).toContainText("You");
    await expect(me.getByRole("button")).toHaveCount(0);
    await expect(
      chairs.getByText(
        "You cannot remove your own role, so that the conference always has a chair.",
      ),
    ).toBeVisible();
    await expect(rowOf(chairs, "admin@example.org").getByRole("button")).toHaveAccessibleName(
      /^Remove .+ as a chair$/,
    );
    // No track chair was ever given the role here: the page has no such part.
    await expect(part(chair, "Track chairs")).toHaveCount(0);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);

    // Nothing typed: the form says what is missing, at the field.
    const send = chair.getByRole("button", { name: "Send the invitation" });
    await expectTouchTarget(send);
    await send.click();
    const address = chair.getByLabel("Email address *");
    await expect(address).toBeFocused();
    await expect(address).toHaveAccessibleDescription("Enter one valid email address.");
    // A reviewer needs a pool. (A call with one pool has it chosen already.)
    await address.fill(email);
    const pools = inviting.getByRole("group", { name: "Committees *" });
    for (const box of await pools.getByRole("checkbox").all()) await box.uncheck();
    await send.click();
    await expect(pools.getByText("Choose at least one committee.")).toBeVisible();
    await expect(pools.getByRole("checkbox").first()).toBeFocused();
    await pools.getByLabel(pool, { exact: true }).check();
    const asReviewer = inviting.getByRole("radio", { name: "Reviewer", exact: true });
    await expect(asReviewer).toBeChecked();
    await expect(asReviewer).toHaveAccessibleDescription(
      "Sees only the proposals the chairs assign to them, and writes a review of each.",
    );
    await expect(
      inviting.getByText(
        "Only chairs see this name, on this page. It is not put in the email, and the person gives their own name when they accept.",
      ),
    ).toBeVisible();
    await expectAccessibleInBothThemes(chair);

    await sendInvitation(chair, email, typed);
    const sent = inviting.getByRole("status");
    await expect(sent).toHaveText(`The invitation was sent to ${email}.`);
    await expect(sent).toBeFocused();
    // The form is ready for the next address; the role and the pool stay.
    await expect(address).toHaveValue("");
    await expect(pools.getByLabel(pool, { exact: true })).toBeChecked();

    // The invitation is listed as the chair typed it, with what can be done about it.
    const invitations = part(chair, "Invitations");
    const row = rowOf(invitations, email);
    await expect(row).toContainText(typed);
    await expect(row).toContainText(`Invited as a reviewer: ${pool}`);
    await expect(row).toContainText("Waiting for an answer");
    await expect(row).toContainText("The link works until");
    await expectTouchTarget(
      row.getByRole("button", { name: `Send again: invitation to ${email}` }),
    );
    await expectTouchTarget(row.getByRole("button", { name: `Cancel the invitation to ${email}` }));
    // The same address cannot be invited to the same role twice.
    await sendInvitation(chair, email);
    await expect(address).toBeFocused();
    await expect(address).toHaveAccessibleDescription(
      "An invitation to this address for this role is already waiting. You can send it again from the list of invitations.",
    );
    await address.fill("");
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);

    // The email: the conference, the committee and the link; no person, typed or real.
    const mail = await invitationMail(request, email);
    expect(mail.subject).toBe(`${title}: invitation to review proposals`);
    expect(mail.text).toContain(`invite you to be a reviewer (${pool})`);
    expect(`${mail.subject}\n${mail.text}`).not.toMatch(/Typed|Fictional|chair@example\.org/);
    expect(mail.link).toMatch(/\/en\/role-invitation#token=role_/);

    // The invitee opens the link on their own phone, with no account.
    const invitee = await newPhone(browser);
    await invitee.goto(mail.link);
    // The heading says what the invitation is to, and so does the name of the page.
    await expect(
      invitee.getByRole("heading", { level: 1, name: "You are invited to review", exact: true }),
    ).toBeVisible();
    await expect(invitee).toHaveTitle("You are invited to review – ELOchair");
    // The token leaves the address bar as soon as it is read.
    await expect(invitee).toHaveURL(/\/en\/role-invitation$/);
    // Under it, who invites: the conference, said once, and not the role again.
    await expect(
      invitee.getByText(`The invitation is from the chairs of ${title}.`, { exact: true }),
    ).toBeVisible();
    await expect(invitee.getByText(title)).toHaveCount(1);
    const details = invitee.locator("dl.details");
    await expect(details.locator("dt")).toHaveText(["Committees", "Invitation for"]);
    await expect(details.locator("dd")).toHaveText([pool, email]);
    await expect(
      invitee.getByText(
        "If you accept: the chairs will assign proposals to you; you read them and write a short review of each.",
      ),
    ).toBeVisible();
    await expect(
      invitee.getByText(
        `This invitation is for ${email}. If you accept, that address gets the role, whoever opens this link. Accepting does not sign you in.`,
      ),
    ).toBeVisible();
    // The name the chair typed is nowhere on the invitee's page, and their own name starts empty.
    await expect(invitee.getByText(typed)).toHaveCount(0);
    const name = invitee.getByLabel("Your name *");
    await expect(name).toHaveValue("");
    const accept = invitee.getByRole("button", { name: "Accept", exact: true });
    const decline = invitee.getByRole("button", { name: "Decline", exact: true });
    await expectTouchTarget(accept);
    await expectTouchTarget(decline);
    await expect(accept).toHaveAccessibleDescription(
      "If you accept: the chairs will assign proposals to you; you read them and write a short review of each.",
    );
    await expectAccessibleInBothThemes(invitee);
    await expectNoHorizontalScroll(invitee);

    // Accepting asks for the invitee's own name, the languages they review in and a number.
    const status = invitee.getByRole("status");
    await accept.click();
    await expect(name).toBeFocused();
    await expect(status).toHaveText("Enter your name to accept.");
    await name.fill(own);
    await accept.click();
    const languages = invitee.getByRole("group", { name: "Languages you can review in *" });
    await expect(languages.getByRole("checkbox").first()).toBeFocused();
    await expect(status).toHaveText("Choose at least one language to accept.");
    await languages.getByLabel("English").check();
    await languages.getByLabel("Español").check();
    const load = invitee.getByLabel("The most proposals you are willing to review *");
    await expect(load).toHaveValue("8");
    await load.fill("31");
    await accept.click();
    await expect(load).toBeFocused();
    await expect(status).toHaveText("Enter a whole number from 1 to 30.");
    await expectAccessibleInBothThemes(invitee);
    await load.fill("5");
    await accept.click();
    await expect(status).toHaveText(
      `Thank you: ${email} is now a reviewer for ${title}. You can sign in with that address at any time.`,
    );
    await expect(status).toBeFocused();
    await expect(accept).toHaveCount(0);
    // The heading still says what was answered.
    await expect(
      invitee.getByRole("heading", { level: 1, name: "You are invited to review" }),
    ).toBeVisible();
    // Accepting signed nobody in: the page offers to sign in with the invited address.
    expect((await invitee.request.get("/api/me")).status()).toBe(401);
    const signInLink = invitee.getByRole("link", { name: `Sign in as ${email}` });
    await expectTouchTarget(signInLink);
    await expectAccessibleInBothThemes(invitee);
    await signInLink.click();
    await expect(invitee).toHaveURL(/\/en\/sign-in$/);
    await expect(invitee.getByLabel("Email address")).toHaveValue(email);

    // The link was used: opened again, it gives a plain page and nothing else, not even a role.
    await invitee.goto(mail.link);
    await expect(
      invitee.getByRole("heading", { level: 1, name: "Invitation", exact: true }),
    ).toBeVisible();
    await expect(invitee.getByRole("status")).toHaveText(
      "This invitation link no longer works: it has expired, was already answered, or was cancelled. If you were sent a newer email, use the link in that one. Otherwise, ask the conference's chairs to invite you again.",
    );
    await expect(invitee.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    await expectAccessibleInBothThemes(invitee);
    await invitee.context().close();

    // The chair's page: a reviewer under that pool, by their own name; the invitation is gone.
    await chair.reload();
    const reviewers = part(chair, "Reviewers");
    const reviewer = rowOf(reviewers, email);
    await expect(reviewer).toHaveCount(1);
    await expect(reviewer).toContainText(own);
    await expect(reviewer).not.toContainText(typed);
    await expect(reviewer).toContainText("No proposals assigned");
    await expect(reviewer).toContainText("Will take up to 5. Reviews in: English, Español.");
    // Under the pool they were invited to: its heading is the one just above their row.
    await expect(
      reviewers
        .locator("div")
        .filter({ has: chair.getByRole("heading", { level: 3, name: pool, exact: true }) })
        .getByText(email),
    ).toBeVisible();
    await expect(rowOf(part(chair, "Invitations"), email)).toHaveCount(0);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);

    // Removing asks first, in place, and says what will happen.
    const removeButton = reviewer.getByRole("button", { name: `Remove ${own} as a reviewer` });
    await expectTouchTarget(removeButton);
    await removeButton.click();
    const question = reviewer.getByRole("heading", { name: `Remove ${own} as a reviewer?` });
    await expect(question).toBeFocused();
    await expect(
      reviewer.getByText(
        `${own} will no longer be a reviewer at this conference, in any committee, and will no longer see the proposals assigned to them. They are not told by email. To make them a reviewer again, invite them again.`,
      ),
    ).toBeVisible();
    await expect(
      reviewer.getByText("None of the proposals you manage is assigned to them."),
    ).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    // "No" changes nothing, and gives focus back to the button that asked.
    await reviewer.getByRole("button", { name: "No, go back" }).click();
    await expect(question).toHaveCount(0);
    await expect(removeButton).toBeFocused();
    await removeButton.click();
    await expectTouchTarget(reviewer.getByRole("button", { name: "Yes, remove" }));
    await reviewer.getByRole("button", { name: "Yes, remove" }).click();
    const removed = reviewers.getByRole("status").first();
    await expect(removed).toHaveText(`${own} is no longer a reviewer at this conference.`);
    await expect(removed).toBeFocused();
    await expect(rowOf(reviewers, email)).toHaveCount(0);
    await chair.reload();
    await expect(rowOf(part(chair, "Reviewers"), email)).toHaveCount(0);
  });

  test("an invitee declines by the link, and the chair sees it on the People page", async ({
    browser,
    request,
  }) => {
    test.slow();
    const email = "e2e-people-declines@example.org";
    const { config } = await stored(chair, CALL);
    const pool = config.reviewPools[0]?.name.en ?? "";
    await openPeople(chair);
    const pools = part(chair, "Invite someone").getByRole("group", { name: "Committees *" });
    await pools.getByLabel(pool, { exact: true }).check();
    await sendInvitation(chair, email, "Declines Typed");
    await expect(part(chair, "Invite someone").getByRole("status")).toHaveText(
      `The invitation was sent to ${email}.`,
    );

    const invitee = await newPhone(browser);
    await invitee.goto((await invitationMail(request, email)).link);
    const decline = invitee.getByRole("button", { name: "Decline", exact: true });
    await expect(decline).toHaveAccessibleDescription(
      "Declining needs nothing more. The chairs will see that you declined; nobody is emailed.",
    );
    // Declining needs nothing: no name, no language, no number.
    await decline.click();
    const status = invitee.getByRole("status");
    await expect(status).toHaveText(
      "You declined. No role was given, and the chairs will see your answer.",
    );
    await expect(status).toBeFocused();
    await expect(invitee.getByRole("link", { name: /Sign in/ })).toHaveCount(0);
    await expectAccessibleInBothThemes(invitee);
    await invitee.context().close();

    // The chair is not emailed: the list is where the answer shows.
    await chair.reload();
    const invitations = part(chair, "Invitations");
    const row = rowOf(invitations, email);
    await expect(row).toContainText("Declined");
    await expect(row).toContainText("Declines Typed");
    await expect(rowOf(part(chair, "Reviewers"), email)).toHaveCount(0);
    // A declined invitation cannot be sent again. It can be taken off the list, which asks first.
    await expect(row.getByRole("button", { name: /^Send again/ })).toHaveCount(0);
    const off = row.getByRole("button", { name: `Take off this list: invitation to ${email}` });
    await expectTouchTarget(off);
    await expectAccessibleInBothThemes(chair);
    await off.click();
    await expect(
      row.getByRole("heading", { name: `Take the invitation to ${email} off this list?` }),
    ).toBeFocused();
    await expect(
      row.getByText("Nothing else changes, and nobody is told. You can invite this address again."),
    ).toBeVisible();
    await row.getByRole("button", { name: "Yes, take it off" }).click();
    const said = invitations.getByRole("status").first();
    await expect(said).toHaveText(`The invitation to ${email} was taken off the list.`);
    await expect(said).toBeFocused();
    await expect(rowOf(invitations, email)).toHaveCount(0);
  });

  test("an invitation to be a chair says what a chair can do, in the language chosen; cancelled, its link stops working", async ({
    browser,
    request,
  }) => {
    test.slow();
    const email = "e2e-people-cochair@example.org";
    const { config } = await stored(chair, CALL);
    const title = config.title.es ?? config.title[config.defaultLanguage] ?? "";
    await openPeople(chair);
    const inviting = part(chair, "Invite someone");
    // Choosing "Chair" says what a chair can do, and takes the pools away.
    const asChair = inviting.getByRole("radio", { name: "Chair", exact: true });
    await asChair.check();
    await expect(asChair).toHaveAccessibleDescription(
      "Can do everything you can: see every proposal and everyone on it, change the conference's settings, invite and remove people, and move the conference from one phase to the next.",
    );
    await expect(inviting.getByRole("group", { name: "Committees *" })).toHaveCount(0);
    await chair.getByLabel("Language of the email").selectOption({ label: "Español" });
    await expectAccessibleInBothThemes(chair);
    await sendInvitation(chair, email);
    await expect(inviting.getByRole("status")).toHaveText(`The invitation was sent to ${email}.`);
    const invitations = part(chair, "Invitations");
    const row = rowOf(invitations, email);
    await expect(row).toContainText("Invited as a chair");

    // The email and the page are in Spanish, as the chair chose.
    const mail = await invitationMail(request, email);
    expect(mail.subject).toBe(`${title}: invitación para presidir el congreso`);
    expect(mail.link).toMatch(/\/es\/role-invitation#token=role_/);
    const invitee = await newPhone(browser);
    await invitee.goto(mail.link);
    await expect(
      invitee.getByRole("heading", {
        level: 1,
        name: "Te invitan a formar parte de la presidencia",
        exact: true,
      }),
    ).toBeVisible();
    await expect(invitee).toHaveTitle("Te invitan a formar parte de la presidencia – ELOchair");
    await expect(
      invitee.getByText(`La invitación es de quienes presiden ${title}.`, { exact: true }),
    ).toBeVisible();
    await expect(
      invitee.getByText(
        "Si aceptas: podrás ver todas las propuestas y a todas las personas que figuran en ellas, cambiar la configuración del congreso, invitar a personas y pasar el congreso de una fase a la siguiente.",
      ),
    ).toBeVisible();
    // A chair has no committees: the address invited is all there is to list.
    await expect(invitee.locator("dl.details dt")).toHaveText(["Invitación para"]);
    await expect(invitee.locator("dl.details dd")).toHaveText([email]);
    // A chair is asked for no languages and no number: only for a name, having none yet.
    await expect(invitee.getByRole("group")).toHaveCount(0);
    await expect(invitee.getByRole("spinbutton")).toHaveCount(0);
    await expect(invitee.getByLabel("Tu nombre *")).toHaveValue("");
    await expectTouchTarget(invitee.getByRole("button", { name: "Aceptar", exact: true }));
    await expectAccessibleInBothThemes(invitee);
    await expectNoHorizontalScroll(invitee);
    // The same page in Portuguese, by the language links.
    await invitee.getByRole("link", { name: /Português/ }).click();
    await expect(invitee).toHaveURL(/\/pt\/role-invitation$/);
    await expect(
      invitee.getByRole("heading", {
        level: 1,
        name: "Tem um convite para integrar a presidência",
        exact: true,
      }),
    ).toBeVisible();

    // The chair cancels the invitation, which asks first. Nobody became a chair.
    const cancel = row.getByRole("button", { name: `Cancel the invitation to ${email}` });
    await cancel.click();
    await expect(
      row.getByRole("heading", { name: `Cancel the invitation to ${email}?` }),
    ).toBeFocused();
    await expect(
      row.getByText(
        "The link in the email stops working, and the invitation leaves this list. Nobody is told.",
      ),
    ).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await row.getByRole("button", { name: "Yes, cancel it" }).click();
    const said = invitations.getByRole("status").first();
    await expect(said).toHaveText(
      `The invitation to ${email} was cancelled. Its link no longer works.`,
    );
    await expect(said).toBeFocused();
    await expect(rowOf(invitations, email)).toHaveCount(0);
    await expect(rowOf(part(chair, "Chairs"), email)).toHaveCount(0);

    // The link now gives the plain page, in the invitee's language. It names no role: a link
    // that no longer works says nothing of what it was for.
    await invitee.goto(mail.link);
    await expect(
      invitee.getByRole("heading", { level: 1, name: "Invitación", exact: true }),
    ).toBeVisible();
    await expect(invitee.getByRole("status")).toHaveText(
      "Este enlace de invitación ya no funciona: caducó, ya se respondió o se canceló. Si te enviaron un correo más reciente, usa el enlace de ese correo. Si no, pide a quienes presiden el congreso que te inviten de nuevo.",
    );
    await expect(invitee.getByRole("button", { name: "Aceptar", exact: true })).toHaveCount(0);
    await invitee.context().close();
  });

  test("the two invitations to a role are among the emails a chair can reword, in each language", async () => {
    test.slow();
    const { config } = await stored(chair, CALL);
    const names = (lang: string) =>
      config.reviewPools.map((p) => p.name[lang] ?? p.name[config.defaultLanguage]).join(", ");
    await openSettings(chair);
    await expect(
      chair.getByText(
        "The app sends these emails to the people on a proposal, and to the people a chair invites as reviewers or chairs.",
        { exact: false },
      ),
    ).toBeVisible();
    // The invitation to review: when it goes and to whom, and what its texts may name.
    const reviewer = await openPool(chair, "Invitation to be a reviewer");
    await expect(reviewer.locator("p.meta").first()).toHaveText(
      "Sent to a person when a chair invites them, on the People page, to be a reviewer, and again if a chair sends the invitation again. That person has not agreed to anything yet, so the email names no person: neither the chair who invites, nor the name that chair typed for them.",
    );
    await expect(reviewer.locator(".placeholders dt")).toHaveText([
      "{committees}",
      "{conference}",
      "{link}",
    ]);
    await expect(reviewer.locator(".placeholders dd")).toHaveText([
      "the names of the review pools the person is invited to, with commas between them",
      "the conference's title",
      "the link where the person reads the invitation and accepts or declinesThe text must contain it, and it cannot go in the subject.",
    ]);
    // The standard text is in the boxes, and the preview names the call's own pools.
    const english = reviewer.getByRole("group", { name: "English" });
    await expect(english.getByLabel("Subject (English)")).toHaveValue(
      "{conference}: invitation to review proposals",
    );
    await expect(english.locator(".email-body")).toContainText(
      `invite you to be a reviewer (${names("en")}).`,
    );
    await expect(english.locator(".email-body")).toContainText("/en/role-invitation#token=…");
    await expect(english.getByText("This is the standard text.")).toBeVisible();
    // A text that names a person is refused where it is typed: this email has no such value.
    const body = english.getByLabel("Text (English)");
    const standard = await body.inputValue();
    await body.fill("{owner} invites you.\n\n{link}");
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(english.locator(".field-error")).toContainText(
      "This email has nothing to put in place of {owner}.",
    );
    await body.fill(standard);
    await expect(english.getByText("This is the standard text.")).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);

    // The invitation to be a chair names the conference and the link, and nothing else.
    const chairs = await openPool(chair, "Invitation to be a chair");
    await expect(chairs.locator("p.meta").first()).toContainText(
      "to be a chair, and again if a chair sends the invitation again.",
    );
    await expect(chairs.locator(".placeholders dt")).toHaveText(["{conference}", "{link}"]);
    // Nothing was changed: nothing is kept in this browser.
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Nothing has been changed.");
    await expect.poll(() => unsavedKeys(chair)).toEqual([]);

    // In Spanish and in Portuguese, each has its name, its line and its placeholders' meanings.
    for (const [lang, name, line, committees] of [
      [
        "es",
        "Invitación para revisar",
        "Se envía a una persona cuando alguien de la presidencia la invita, en la página Personas, a revisar",
        "los nombres de los grupos de revisión a los que se invita a la persona, separados por comas",
      ],
      [
        "pt",
        "Convite para rever",
        "É enviado a uma pessoa quando alguém da presidência a convida, na página Pessoas, para rever",
        "os nomes dos grupos de revisão para os quais a pessoa é convidada, separados por vírgulas",
      ],
    ] as const) {
      await chair.goto(`/${lang}/c/${CALL}/settings`);
      const section = chair
        .locator("details")
        .filter({ has: chair.locator("summary", { hasText: name }) });
      await section.locator("summary").click();
      await expect(section.locator("p.meta").first()).toContainText(line);
      await expect(section.locator(".placeholders dd").first()).toHaveText(committees);
      // The email in that language, previewed with the call's pools as that language names them.
      await expect(section.locator(`.email-body[lang="${lang}"]`)).toContainText(
        `(${names(lang)})`,
      );
      await expect(section.locator(`.email-body[lang="${lang}"]`)).toContainText(
        `/${lang}/role-invitation#token=…`,
      );
    }
    await expect.poll(() => unsavedKeys(chair)).toEqual([]);
  });

  /*
   * Assignments (spec 03, §1.3). They are here because this file has a chair signed in, who
   * chairs the sandbox too: nobody signs in below, and no conference's phase is moved.
   *
   * The sandbox is in review, and other tests read what two of its reviewers are assigned
   * (reviewer-1 in smoke.spec.ts, reviewer-30 in review.spec.ts). This test keeps clear of both,
   * by rule and not by luck:
   * - of each committee it takes the first proposal on the Assignments list that neither of the
   *   two reviews, and on that proposal's page the first reviewer offered who is neither of them;
   * - a reviewer who is offered is not on the proposal, so the only assignment this test ever
   *   removes is the one it has just made. No seeded assignment is released.
   * Every proposal it touches therefore ends with the reviewers it had (checked at the end),
   * each of the two reviewers taken has the number of proposals they had, and what the other
   * tests read (a reviewer's own list, the guard on anonymity) never changes. The one trace is a
   * released row for each pair, which counts nowhere; both formats had reviewers already.
   *
   * Reviewer-30 writes beside this test (review.spec.ts): reviews of their own proposals, one of
   * which they give back. That changes those proposals on the Assignments list (who reviews
   * them, how many reviews were sent, whether they are short), the totals above them, and
   * reviewer-30's own number of proposals, at a moment this test cannot know. So this test
   * compares nothing that reviewer-30 can change:
   * - what the page shows is held to the answer the page itself was given, not to one asked for
   *   a moment earlier;
   * - "as it was found" is said of the proposals that neither of the two reviewed when this
   *   test began (the only ones it could touch), and of the people offered other than the two.
   */
  test("a chair sees where reviewers are missing, assigns one on the proposal's page, and removes them again", async () => {
    test.slow();
    const SANDBOX = "sandbox";
    const KEPT = ["reviewer-1@example.org", "reviewer-30@example.org"];
    type Holder = { personId: string; displayName: string | null; email: string };
    type Listed = {
      key: string;
      needed: number;
      proposals: number;
      short: number;
      waiting: number;
      items: { id: string; title: string; reviewers: Holder[]; short: boolean; sent: number }[];
      nextCursor: string | null;
    };
    type Section = {
      needed: number;
      assigned: Holder[];
      takes: string;
      candidates: (Holder & { assigned: number; maxLoad: number | null; full: boolean })[];
    };
    const got = async <T>(path: string) => (await (await chair.request.get(path)).json()) as T;
    const sectionOf = (slug: string, id: string) =>
      got<Section>(`/api/conferences/${slug}/assignments/submissions/${id}`);
    const loadOf = async (personId: string) =>
      (
        await got<{ reviewers: { personId: string; assigned: number }[] }>(
          `/api/conferences/${SANDBOX}/people`,
        )
      ).reviewers.find((r) => r.personId === personId)?.assigned;
    /** One of the page's widths: nothing scrolls sideways at either. */
    const atBothWidths = async (check: () => Promise<void>) => {
      await check();
      await chair.setViewportSize({ width: 360, height: 800 });
      await check();
      await chair.setViewportSize({ width: 390, height: 844 });
    };

    // The open call first: its closing date has not passed, so nobody can be assigned yet. The
    // page says so, and lists what was submitted, each proposal still short of reviewers.
    await chair.goto(`/en/c/${CALL}/manage`);
    const link = chair.getByRole("link", { name: "Assignments", exact: true });
    await expectTouchTarget(link);
    await link.click();
    await expect(chair).toHaveURL(new RegExp(`/en/c/${CALL}/assignments$`));
    // A new page: its heading takes focus.
    await expect(chair.getByRole("heading", { level: 1, name: "Assignments" })).toBeFocused();
    await expect(
      chair.getByText(
        "Every proposal that can be given reviewers, under the committee that reviews it. Those that still need reviewers come first, then those still waiting for reviews. To assign or remove a reviewer, or to read the reviews that were sent, open the proposal. Nothing is assigned automatically, and nobody is emailed.",
      ),
    ).toBeVisible();
    await expect(
      chair.getByText(
        "The call has not closed yet, so no reviewer can be assigned. The proposals submitted so far are listed.",
      ),
    ).toBeVisible();
    // The reading sent in by the test above: nobody reviews it, and it says how many it needs.
    const waiting = chair
      .locator("ul.cards > li")
      .filter({ has: chair.getByRole("link", { name: "A reading for forty words" }) });
    await expect(waiting.locator(".badge")).toHaveText(/^Needs (1|\d+) more$/);
    await expect(waiting.getByText(/^Reviewers: 0 of \d+$/)).toBeVisible();
    // No review of it was sent: nobody reviews it yet.
    await expect(waiting.getByText("Reviews sent: 0", { exact: true })).toBeVisible();
    await expect(waiting.getByText("No reviewer yet")).toBeVisible();
    await expectTouchTarget(waiting.getByRole("link"));
    await expectAccessibleInBothThemes(chair);
    await atBothWidths(() => expectNoHorizontalScroll(chair));
    // Its own page says the same where a reviewer would be assigned, and offers nobody.
    await waiting.getByRole("link").click();
    await expect(chair).toHaveURL(/\/en\/s\/[0-9a-f-]+#reviewers$/);
    const early = chair.getByRole("region", { name: "Reviewers" });
    await expect(early.getByRole("heading", { level: 2, name: "Reviewers" })).toBeFocused();
    await expect(
      early.getByText(
        "No reviewer can be assigned yet: the call has not closed. Reviewers can be assigned once its closing date has passed, or once the conference is in review.",
      ),
    ).toBeVisible();
    await expect(
      early.getByText(/will be able to read this proposal once the conference is in review/),
    ).toBeVisible();
    await expect(early.getByRole("button")).toHaveCount(0);

    // The sandbox: its call closed long ago, and it is in review. Which proposals and reviewers
    // this test takes is decided by the rule above, from what the server lists.
    const listed = await got<{ excluded: number; callClosed: boolean; pools: Listed[] }>(
      `/api/conferences/${SANDBOX}/assignments?limit=200`,
    );
    expect(listed.callClosed).toBe(true);
    const names = (await stored(chair, SANDBOX)).config.reviewPools;
    const taken: {
      committee: string;
      proposal: Listed["items"][number];
      reviewer: Section["candidates"][number];
      before: Section;
      load: number;
    }[] = [];
    for (const pool of listed.pools) {
      for (const proposal of pool.items) {
        if (proposal.reviewers.some((r) => KEPT.includes(r.email))) continue;
        const before = await sectionOf(SANDBOX, proposal.id);
        const reviewer = before.candidates.find((c) => !KEPT.includes(c.email));
        if (!reviewer) continue;
        taken.push({
          committee: names.find((x) => x.key === pool.key)?.name.en ?? "",
          proposal,
          reviewer,
          before,
          load: (await loadOf(reviewer.personId)) ?? -1,
        });
        break;
      }
    }
    expect(taken.map((x) => x.committee)).toEqual(names.map((x) => x.name.en));
    // Between them the two show both ways of assigning: someone who has reached the number of
    // proposals they said they would take is asked about first, anyone else is one press.
    expect(taken.map((x) => x.reviewer.full).sort()).toEqual([false, true]);

    await chair.goto(`/en/c/${SANDBOX}/manage`);
    // What the page is given is what it is held to (see above: the list may change meanwhile).
    const given = chair.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/conferences/${SANDBOX}/assignments`,
    );
    await chair.getByRole("link", { name: "Assignments", exact: true }).click();
    const shownPools = ((await (await given).json()) as { pools: Listed[] }).pools;
    await expect(chair.getByRole("heading", { level: 1, name: "Assignments" })).toBeFocused();
    await expect(chair.getByText("The call has not closed yet")).toHaveCount(0);
    for (const [i, pool] of shownPools.entries()) {
      const part = chair.getByRole("region", { name: names[i]?.name.en ?? "", exact: true });
      // How many proposals, how many still short, and what the committee asks for.
      const short =
        pool.short === 0
          ? "None still needs reviewers."
          : pool.short === 1
            ? "1 still needs reviewers."
            : `${pool.short} still need reviewers.`;
      await expect(part.locator("p").first()).toHaveText(
        `${pool.proposals} proposals. ${short} This committee asks for ${pool.needed} reviewers for each proposal.`,
      );
      // A long list comes a page at a time.
      const shown = Math.min(50, pool.proposals);
      await expect(part.locator("ul.cards > li")).toHaveCount(shown);
      if (pool.proposals > 50) {
        await expect(part.getByText(`Showing 50 of ${pool.proposals}`)).toBeVisible();
        const more = part.getByRole("button", { name: "Show more" });
        await expectTouchTarget(more);
        await more.focus();
        await chair.keyboard.press("Enter");
        const next = Math.min(100, pool.proposals);
        await expect(part.getByText(`Showing ${next} of ${pool.proposals}`)).toBeVisible();
        await expect(part.locator("ul.cards > li")).toHaveCount(next);
        // The first new proposal takes focus, so the keyboard goes on from there.
        await expect(part.locator("ul.cards > li").nth(50).getByRole("link")).toBeFocused();
      }
      // Each proposal says how many reviewers it has of those it needs, and who they are.
      const first = pool.items[0];
      if (!first) throw new Error("a committee of the sandbox has no proposal");
      const card = part.locator("ul.cards > li").first();
      await expect(card.getByRole("link")).toHaveText(first.title);
      await expect(
        card.getByText(`Reviewers: ${first.reviewers.length} of ${pool.needed}`),
      ).toBeVisible();
      // Beside it, how many reviews of the proposal were sent.
      await expect(card.getByText(`Reviews sent: ${first.sent}`, { exact: true })).toBeVisible();
      await expect(card.locator(".badge")).toHaveText(
        first.short ? /^Needs \d+ more$/ : "Has its reviewers",
      );
      await expect(card.locator("p.meta").last()).toHaveText(
        first.reviewers.map((r) => r.displayName ?? r.email).join(", ") || "No reviewer yet",
      );
    }
    // The committees are a list of links at the top, each to its own part of the page.
    const jump = chair.getByRole("navigation", { name: "Committees" });
    const second = names[1]?.name.en ?? "";
    await expectTouchTarget(jump.getByRole("link", { name: second }));
    await jump.getByRole("link", { name: second }).click();
    await expect(chair.getByRole("heading", { level: 2, name: second })).toBeFocused();
    await expectAccessibleInBothThemes(chair);
    await atBothWidths(() => expectNoHorizontalScroll(chair));

    for (const { committee, proposal, reviewer, before } of taken) {
      const name = reviewer.displayName ?? reviewer.email;
      // From the list to the proposal's page, at the part where its reviewers are.
      await chair.goto(`/en/c/${SANDBOX}/assignments`);
      const part = chair.getByRole("region", { name: committee, exact: true });
      // (By the link's own id: two of the sandbox's made-up titles may be alike.)
      const open = chair.locator(`[id="proposal-${proposal.id}"]`);
      while ((await open.count()) === 0) {
        const shown = await part.locator("ul.cards > li").count();
        await part.getByRole("button", { name: "Show more" }).click();
        await expect(part.locator("ul.cards > li")).not.toHaveCount(shown);
      }
      await expect(open).toHaveText(proposal.title);
      await open.click();
      await expect(chair).toHaveURL(new RegExp(`/en/s/${proposal.id}#reviewers$`));
      const section = chair.getByRole("region", { name: "Reviewers" });
      await expect(section.getByRole("heading", { level: 2, name: "Reviewers" })).toBeFocused();
      // What assigning does, in a sentence, and that it mails nobody.
      await expect(
        section.getByText(
          /^A reviewer you assign here can read this proposal from then on, (anonymized: without the authors' names|with the authors' names and affiliations)\. Nobody is emailed when you assign or remove a reviewer\.$/,
        ),
      ).toBeVisible();
      await expect(
        section.getByText(
          `Reviewers assigned: ${before.assigned.length} of ${before.needed}. Committee: ${committee}. It asks for ${before.needed} reviewers for each proposal.`,
        ),
      ).toBeVisible();
      const said = section.getByRole("status").first();
      await expect(said).toHaveText("");
      const reviewing = section.getByRole("list", { name: "Reviewers", exact: true });
      await expect(reviewing.getByRole("listitem")).toHaveCount(before.assigned.length);

      // A long list of reviewers has a box to find one by name: accents and capitals aside.
      const offered = section.getByRole("list", { name: "Assign a reviewer" });
      const find = section.getByLabel("Find a reviewer by name or email address");
      if (before.candidates.length > 8) {
        await expectTouchTarget(find);
        await find.fill(name.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase());
        await expect(
          offered.getByRole("listitem").filter({ hasText: reviewer.email }),
        ).toBeVisible();
        await expect(section.getByText(/^Showing \d+ of \d+$/)).toBeVisible();
        await find.fill("zzzz no such person");
        await expect(section.getByText("No reviewer matches what you typed.")).toBeVisible();
        await expect(offered.getByRole("listitem")).toHaveCount(0);
        await find.fill(reviewer.email);
        await expect(offered.getByRole("listitem")).toHaveCount(1);
      } else {
        await expect(find).toHaveCount(0);
      }
      const row = offered.getByRole("listitem").filter({ hasText: reviewer.email });
      // Their load beside the most they said they would take, and the languages they review in.
      await expect(
        row.getByText(
          new RegExp(`^${reviewer.assigned} assigned of ${reviewer.maxLoad} · Reviews in: `),
        ),
      ).toBeVisible();
      const assign = row.getByRole("button", { name: `Assign ${name} to this proposal` });
      await expectTouchTarget(assign);
      await expectAccessibleInBothThemes(chair);
      await atBothWidths(() => expectNoHorizontalScroll(chair));

      if (reviewer.full) {
        // They have reached their number: the page says so in a line, and asks before assigning.
        await expect(
          row.getByText("Has reached the number of proposals they said they would take."),
        ).toBeVisible();
        await assign.click();
        const question = row.getByRole("heading", { name: `Assign ${name} all the same?` });
        await expect(question).toBeFocused();
        await expect(
          row.getByText(
            `${name} said they would take at most ${reviewer.maxLoad} proposals, and has ${reviewer.assigned}. That number is what they offered, not a limit: you can still assign them.`,
          ),
        ).toBeVisible();
        await expect(assign).toHaveCount(0);
        const yes = row.getByRole("button", { name: "Yes, assign" });
        await expectTouchTarget(yes);
        await expectAccessibleInBothThemes(chair);
        await atBothWidths(() => expectNoHorizontalScroll(chair));
        // "No" changes nothing, and gives focus back to the button that asked.
        await row.getByRole("button", { name: "No, go back" }).click();
        await expect(assign).toBeFocused();
        expect((await sectionOf(SANDBOX, proposal.id)).assigned).toEqual(before.assigned);
        // The request does not arrive: the question stays, and says so.
        await chair.route("**/assignments/submissions/*/reviewers", (route) => route.abort());
        await assign.click();
        await yes.click();
        await expect(row.getByRole("status")).toHaveText(
          "The server did not confirm this. Please try again.",
        );
        await chair.unroute("**/assignments/submissions/*/reviewers");
        await yes.click();
      } else {
        await expect(row.getByText("Has reached the number of proposals")).toHaveCount(0);
        await assign.click();
      }
      // Done: the page says so where it was done, and the line takes focus.
      await expect(said).toHaveText(
        `${name} is now a reviewer of this proposal. Nobody was emailed.`,
      );
      await expect(said).toBeFocused();
      await expect(
        section.getByText(
          `Reviewers assigned: ${before.assigned.length + 1} of ${before.needed}.`,
          { exact: false },
        ),
      ).toBeVisible();
      const mine = reviewing.getByRole("listitem").filter({ hasText: reviewer.email });
      await expect(mine.getByText(/^Assigned /)).toBeVisible();
      // No longer offered: they are on it.
      await expect(
        section.getByRole("button", { name: `Assign ${name} to this proposal` }),
      ).toHaveCount(0);
      expect(await loadOf(reviewer.personId)).toBe(reviewer.assigned + 1);

      // Removing asks first, in place, and says what will happen.
      const remove = mine.getByRole("button", { name: `Remove from this proposal: ${name}` });
      await expect(remove).toHaveText("Remove from this proposal");
      await expectTouchTarget(remove);
      await remove.click();
      await expect(
        mine.getByRole("heading", { name: `Remove ${name} from this proposal?` }),
      ).toBeFocused();
      await expect(
        mine.getByText(
          `${name} will no longer be able to read this proposal, and it will no longer count as one of theirs. They are not told by email. You can assign them again later.`,
        ),
      ).toBeVisible();
      await expectAccessibleInBothThemes(chair);
      await atBothWidths(() => expectNoHorizontalScroll(chair));
      await mine.getByRole("button", { name: "No, go back" }).click();
      await expect(remove).toBeFocused();
      expect((await sectionOf(SANDBOX, proposal.id)).assigned).toHaveLength(
        before.assigned.length + 1,
      );
      await remove.click();
      await mine.getByRole("button", { name: "Yes, remove" }).click();
      await expect(said).toHaveText(`${name} was removed from this proposal. Nobody was emailed.`);
      await expect(said).toBeFocused();
      await expect(reviewing.getByRole("listitem")).toHaveCount(before.assigned.length);
      // They can be assigned again: offered once more, with the number they had.
      await expect(
        section.getByRole("button", { name: `Assign ${name} to this proposal` }),
      ).toBeVisible();

      // As it was found: the proposal has the reviewers it had, and the reviewer their number.
      const after = await sectionOf(SANDBOX, proposal.id);
      expect(after.assigned).toEqual(before.assigned);
      // (The two reviewers other tests read are left out: one of them gives a proposal back
      // beside this test, and their number of proposals changes with it.)
      const others = (x: Section) => x.candidates.filter((c) => !KEPT.includes(c.email));
      expect(others(after)).toEqual(others(before));
      expect(await loadOf(reviewer.personId)).toBe(reviewer.assigned);
    }

    // In Spanish and in Portuguese the section is in that language, and says "committee".
    const [{ proposal, committee }] = taken as [(typeof taken)[number], ...unknown[]];
    for (const [lang, title, does, asks] of [
      [
        "es",
        "Quienes revisan",
        "Quien asignes aquí podrá leer esta propuesta desde ese momento",
        `Comité: ${committee}. Pide`,
      ],
      [
        "pt",
        "Quem revê",
        "Quem atribuir aqui poderá ler esta proposta a partir desse momento",
        `Comissão: ${committee}. Pede`,
      ],
    ] as const) {
      await chair.goto(`/${lang}/s/${proposal.id}`);
      const section = chair.getByRole("region", { name: title });
      await expect(section.getByText(does, { exact: false })).toBeVisible();
      await expect(section.getByText(asks, { exact: false })).toBeVisible();
      await expectNoHorizontalScroll(chair);
    }
    await chair.goto(`/es/c/${SANDBOX}/assignments`);
    await expect(chair.getByRole("heading", { level: 1, name: "Asignaciones" })).toBeVisible();
    await chair.goto(`/pt/c/${SANDBOX}/assignments`);
    await expect(chair.getByRole("heading", { level: 1, name: "Atribuições" })).toBeVisible();
    await expectNoHorizontalScroll(chair);

    // The list is as it was found: every proposal that neither of the two reviewed when this
    // test began (the only ones it could touch) has the reviewers and the reviews it had, in
    // the order they were in.
    const untouched = (pools: Listed[]) =>
      pools.map((pool) => ({
        key: pool.key,
        items: pool.items.filter((item) => !theirs.has(item.id)),
      }));
    const theirs = new Set(
      listed.pools.flatMap((pool) =>
        pool.items
          .filter((item) => item.reviewers.some((r) => KEPT.includes(r.email)))
          .map((item) => item.id),
      ),
    );
    const now = await got<{ pools: Listed[] }>(`/api/conferences/${SANDBOX}/assignments?limit=200`);
    expect(untouched(now.pools)).toEqual(untouched(listed.pools));
  });

  /*
   * A chair may also review (spec 03, §1.4). The chair of these tests holds both roles at a
   * small conference seeded for this, `chair-reviews`, with three talks assigned to them:
   * nothing here touches the sandbox, and no other test reads that conference. The talk written
   * to is the first on the chair's own list that has no review yet, so a second attempt of this
   * test takes the next one.
   */
  test("a chair who also reviews writes their review on the proposal's page, above its reviewers", async () => {
    const ROOM = "chair-reviews";
    const TEXT = "Browser test, a chair's own review: clear, and well made.";
    type Row = { submissionId: string; title: string; status: string };
    const mine = async () => {
      const all = (await (await chair.request.get("/api/me/reviews")).json()) as {
        conferences: { conference: { slug: string }; proposals: Row[] }[];
      };
      return all.conferences.find((k) => k.conference.slug === ROOM)?.proposals ?? [];
    };
    const target = (await mine()).find((p) => p.status === "not_started");
    if (!target) throw new Error("no talk without a review is left at chair-reviews");
    const committee = (await stored(chair, ROOM)).config.reviewPools[0];
    if (!committee) throw new Error("chair-reviews has no committee");

    // The main menu offers a chair who reviews their list, and the talk is on it.
    await chair.goto("/en/reviews");
    await expect(chair.getByRole("heading", { level: 1, name: "My reviews" })).toBeVisible();
    await expect(
      chair.locator(".site-header").getByRole("link", { name: "My reviews" }),
    ).toBeVisible();
    await chair.locator(`a[href="/en/s/${target.submissionId}"]`).click();
    await expect(chair.getByRole("heading", { level: 1, name: target.title })).toBeFocused();
    // They read it as a chair: its people are named, although this committee reviews
    // anonymized. Their own review is on the page all the same, above the proposal's reviewers.
    await expect(chair.getByRole("heading", { level: 2, name: "People" })).toBeVisible();
    await expect(chair.locator("main")).toContainText("Fictional Author");
    const review = chair.getByRole("region", { name: "Your review" });
    const reviewers = chair.getByRole("region", { name: "Reviewers" });
    const send = review.getByRole("button", { name: "Send review" });
    await expectTouchTarget(send);
    await expect(reviewers.getByRole("heading", { level: 2, name: "Reviewers" })).toBeVisible();
    const top = async (part: Locator) => (await part.boundingBox())?.y ?? 0;
    expect(await top(review)).toBeLessThan(await top(reviewers));
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 360, height: 740 });
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 390, height: 844 });

    // Filled in and sent, like any reviewer's.
    for (const criterion of committee.criteria) {
      await review
        .getByRole("group", { name: criterion.label.en ?? "", exact: true })
        .getByRole("radio", { name: "4", exact: true })
        .check();
    }
    await review.getByLabel("Comments for the authors").fill(TEXT);
    await review
      .getByRole("group", { name: "Your recommendation" })
      .getByRole("radio", { name: "Accept" })
      .check();
    await send.click();
    await expect(review.getByRole("status")).toHaveText(
      "Your review was sent. The chairs can read it now. You can change it while the conference is in review.",
    );
    await expect(review.getByRole("button", { name: "Change my review" })).toBeVisible();
    await expect.poll(() => unsavedKeys(chair)).toEqual([]);
    expect((await mine()).find((p) => p.submissionId === target.submissionId)?.status).toBe("sent");

    // Opened again, the Reviewers section shows it as every chair of the conference reads it,
    // under their name; and its reviewer is no longer removed from the proposal.
    await chair.reload();
    const theirs = reviewers
      .getByRole("list", { name: "Reviewers", exact: true })
      .locator("> li")
      .filter({ hasText: "chair@example.org" });
    await expect(theirs.getByRole("group", { name: "Review by Fictional Chair" })).toContainText(
      TEXT,
    );
    await expect(theirs.getByRole("button")).toHaveCount(0);
    await expect(review.getByText(TEXT)).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
  });

  /*
   * The review form is the chairs' to word (spec 03, §1.8): every limit and every description a
   * reviewer meets on it is a setting, with the same change, review and save as the rest. Done
   * on the open call, where nobody reviews yet and no other test reads these values, and put
   * back as it was found.
   */
  test("a chair words the review form, sets its limits and the day reviews are due, and puts it all back", async () => {
    test.slow();
    const before = await stored(chair, CALL);
    const pool = before.config.reviewPools[0];
    const criterion = pool?.criteria[0];
    if (!pool || !criterion) throw new Error("the call has no review pool with a criterion");
    const poolName = pool.name.en ?? "";
    const label = criterion.label.en ?? "";
    // What this test reads and writes is not set on the call as it is seeded.
    expect(before.config.deadlines).not.toHaveProperty("reviewsDue");
    expect(criterion).not.toHaveProperty("description");
    expect(pool.form).toEqual({
      comments: {},
      chairNote: { enabled: true },
      recommendation: { enabled: true },
    });
    const { submissionsClose, notification } = before.config.deadlines;
    const offset = /(Z|[+-]\d{2}:\d{2})$/.exec(notification)?.[1] ?? "";
    // A day ten days after the call closes: before decisions are sent, thirty days after it.
    const day = new Date(Date.parse(submissionsClose) + 10 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const due = `${day}T23:59:00${offset}`;
    expect(Date.parse(due)).toBeGreaterThan(Date.parse(submissionsClose));
    expect(Date.parse(due)).toBeLessThan(Date.parse(notification));

    await openSettings(chair);
    // The day reviews are due: optional, with a line that says what it does and does not do.
    const dueGroup = chair.getByRole("group", { name: "Reviews due" });
    await expect(
      dueGroup.getByText(
        "Optional. Reviewers are shown this day on their list. It locks nothing: reviews can be sent and changed for as long as the conference is in review. For no day, leave the date empty.",
      ),
    ).toBeVisible();
    await expect(dueGroup.getByLabel("Date")).toHaveValue("");
    // The end of the day, on the clock the day decisions are sent is written on: shown, so that
    // typing a date is enough, and what is saved is what is shown.
    await expect(dueGroup.getByLabel("Time")).toHaveValue("23:59");
    await expect(dueGroup.getByLabel("Offset from UTC")).toHaveValue(
      offset === "Z" ? "+00:00" : offset,
    );
    await expect(dueGroup.getByText("No day is set.")).toBeVisible();
    await expect(dueGroup.getByLabel("Date")).toHaveAccessibleDescription(/No day is set\.$/);
    await dueGroup.getByLabel("Date").fill(day);
    await expect(dueGroup.getByText(/Conference time/)).toBeVisible();
    await expect(dueGroup.getByText("No day is set.")).toHaveCount(0);

    // The form's settings are in the committee's own section.
    const section = await openPool(chair, poolName);
    const one = section.getByRole("group", { name: `Criterion: ${label}` });
    const described = one.getByLabel("Description (English)");
    await expect(described).toHaveValue("");
    await expect(described).toHaveAccessibleDescription(
      "Optional. What this criterion asks, or what its lowest and highest scores mean. Reviewers read it under the criterion's name on the review form.",
    );
    const explained = "1 is far from the theme; 5 is at the heart of it.";
    await described.fill(explained);

    const form = section.getByRole("group", { name: "The review form" });
    await expect(
      form.getByText(
        "Under the scores, this committee's review form has comments for the authors, a note for the chairs only, and an overall recommendation. Their names are the app's own. What is written under each, the limits on the comments, and whether the form has the note and the recommendation, are yours to set.",
      ),
    ).toBeVisible();
    const under = form.getByLabel(
      "Comments for the authors: what is written under the field (English)",
    );
    // Left empty, reviewers read the standard sentence, which the hint quotes.
    await expect(under).toHaveValue("");
    await expect(under).toHaveAccessibleDescription(
      "Optional. Left empty, reviewers read the standard sentence: “The authors receive this with the decision. Say what is strong, what is unclear, and what would improve it.”",
    );
    const fewest = form.getByLabel("Comments for the authors: fewest words");
    const most = form.getByLabel("Comments for the authors: most words");
    const hasNote = form.getByLabel("The form has a note for the chairs only");
    const asksRecommendation = form.getByLabel(
      "The form asks for an overall recommendation: accept, unsure or reject",
    );
    await expect(fewest).toHaveValue("");
    await expect(most).toHaveValue("");
    await expect(hasNote).toBeChecked();
    await expect(asksRecommendation).toBeChecked();
    await expect(
      form.getByLabel("Note for the chairs only: what is written under the field (English)"),
    ).toHaveAccessibleDescription(
      "Optional. Left empty, reviewers read the standard sentence: “The authors never see this.”",
    );
    await expect(
      form.getByLabel("Recommendation: what is written under its name (English)"),
    ).toHaveAccessibleDescription("Optional. Left empty, nothing is written there.");
    await expectTouchTarget(under);
    await expectTouchTarget(fewest);
    await expectTouchTarget(form.locator("label.choice").first());
    const worded = "Write to the authors as you would want to be written to.";
    await under.fill(worded);
    await fewest.fill("20");
    await most.fill("10");
    await hasNote.uncheck();
    await expect(chair.getByText("Values changed and not saved yet: 6.")).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 360, height: 740 });
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 390, height: 844 });

    // More words asked for than allowed: refused in the review, beside the fewest.
    await chair.getByRole("button", { name: "Review changes" }).click();
    const summary = chair.getByRole("alert").filter({ hasText: "Please fix the following" });
    await expect(summary).toBeFocused();
    const why = "This must not be more than the largest value beside it.";
    await expect(summary).toContainText(
      `${poolName} · Comments for the authors: fewest words: ${why}`,
    );
    await expect(fewest).toHaveAttribute("aria-invalid", "true");
    await expect(fewest).toHaveAccessibleDescription(new RegExp(`${why}$`));
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await fewest.fill("5");
    await most.fill("400");

    // Every change is reviewed, by name, before anything is saved.
    await chair.getByRole("button", { name: "Review changes" }).click();
    const review = chair.getByRole("region", { name: "Review your changes" });
    await expect(chair.getByRole("heading", { name: "Review your changes" })).toBeFocused();
    await expect(review.getByRole("listitem")).toHaveCount(6);
    /** One change in the review: the value by its full name, what it was and what it becomes. */
    const changed = (name: string, from: string, to: string) =>
      expect(review.getByRole("listitem").filter({ hasText: name })).toContainText(
        `from “${from}” to “${to}”`,
      );
    await changed(
      "Reviews due",
      "empty",
      `${shownInBogota(due)} (${before.config.timezone}), stored as ${due}`,
    );
    await changed(`${poolName} · ${label} · Description (English)`, "empty", explained);
    await changed(
      `${poolName} · Comments for the authors: what is written under the field (English)`,
      "empty",
      worded,
    );
    await changed(`${poolName} · Comments for the authors: fewest words`, "empty", "5");
    await changed(`${poolName} · Comments for the authors: most words`, "empty", "400");
    await changed(`${poolName} · The form has a note for the chairs only`, "yes", "no");
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.getByRole("button", { name: "Save changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Settings saved.");

    // It is what the conference holds now, and so what the next reviewer's form is made from.
    const saved = (await stored(chair, CALL)).config;
    expect(saved.deadlines.reviewsDue).toBe(due);
    expect(saved.reviewPools[0]?.criteria[0]?.description).toEqual({ en: explained });
    expect(saved.reviewPools[0]?.form).toEqual({
      comments: { description: { en: worded }, minWords: 5, maxWords: 400 },
      chairNote: { enabled: false },
      recommendation: { enabled: true },
    });
    // The other committee's form is as it was.
    expect(saved.reviewPools.slice(1)).toEqual(before.config.reviewPools.slice(1));
    await chair.reload();
    await expect(
      chair.getByRole("heading", { level: 1, name: "Conference settings" }),
    ).toBeVisible();
    await expect(chair.getByText(RESTORED)).toHaveCount(0);
    await expect(dueGroup.getByLabel("Date")).toHaveValue(day);
    await openPool(chair, poolName);
    await expect(described).toHaveValue(explained);
    await expect(fewest).toHaveValue("5");
    await expect(most).toHaveValue("400");
    await expect(hasNote).not.toBeChecked();

    // Back exactly as it was, for the tests that run beside this one: an emptied date takes
    // the day away, an emptied box its limit or its text.
    await dueGroup.getByLabel("Date").fill("");
    await expect(dueGroup.getByText("No day is set.")).toBeVisible();
    await described.fill("");
    await under.fill("");
    await fewest.fill("");
    await most.fill("");
    await hasNote.check();
    await reviewAndSave(chair);
    const after = await stored(chair, CALL);
    expect(after.config.deadlines).toEqual(before.config.deadlines);
    expect(after.config.reviewPools).toEqual(before.config.reviewPools);
    expect(after.token).toBe(before.token);
    await expect.poll(() => unsavedValues(chair)).toBeNull();
  });

  /*
   * What the chairs are shown of a review (spec 03, §1.4). This file has the chair, and
   * review.spec.ts the reviewer, signed in once each: nobody signs in here.
   *
   * It is the one test that depends on another file. Reviewer-30 sends a review beside this
   * file, and the last thing they write is that review with the words of FINAL as its comments
   * (the rule is at the top of review.spec.ts). This test waits for exactly that, wherever it
   * was written, so that it reads a review nobody is still changing; before it, reviewer-30
   * has given one proposal back, with the note GIVEN_BACK. It is the last test of the file: run
   * without review.spec.ts, nothing sends that review, and this test alone fails for want of it.
   *
   * It changes nothing: the one value it types in the sandbox's settings is refused in the
   * review step, as it has to be, and is taken back.
   */
  test("a chair reads the review a reviewer sent, on the proposal's page, and sees who could not review", async () => {
    test.setTimeout(240_000);
    const SANDBOX = "sandbox";
    const REVIEWER = "reviewer-30@example.org";
    /** The comments of the review as review.spec.ts last sends it: the same words as there. */
    const FINAL =
      "Browser test, final version: the piece holds together, and the plan to show it online is clear enough to stage.";
    /** The note reviewer-30 leaves when they give a proposal back: the same words as there. */
    const GIVEN_BACK = "Browser test: away from the desk until the reviews are due.";
    type Holder = { personId: string; displayName: string | null; email: string };
    type Sent = {
      scores: Record<string, number>;
      comments: string;
      chairNote: string;
      recommendation: string | null;
      sentAt: string;
      changedAt: string | null;
    };
    type Section = {
      needed: number;
      assigned: (Holder & { review: Sent | null })[];
      declined: (Holder & { reason: string; note: string | null })[];
      candidates: Holder[];
    };
    type Listed = {
      key: string;
      needed: number;
      items: { id: string; title: string; reviewers: Holder[]; sent: number }[];
    };
    const got = async <T>(path: string) => (await (await chair.request.get(path)).json()) as T;
    const sectionOf = (id: string) =>
      got<Section>(`/api/conferences/${SANDBOX}/assignments/submissions/${id}`);
    const listed = () =>
      got<{ pools: Listed[] }>(`/api/conferences/${SANDBOX}/assignments?limit=200`);
    /** The proposal reviewer-30 has sent their last review of, once they have. */
    const reviewed = async () => {
      for (const pool of (await listed()).pools) {
        for (const item of pool.items) {
          if (item.sent < 1 || !item.reviewers.some((r) => r.email === REVIEWER)) continue;
          const section = await sectionOf(item.id);
          const theirs = section.assigned.find((a) => a.email === REVIEWER);
          if (theirs?.review?.comments === FINAL) return { pool, item, section, theirs };
        }
      }
      return null;
    };
    await expect
      .poll(async () => (await reviewed()) !== null, {
        message: "reviewer-30's last review, which review.spec.ts sends beside this file",
        timeout: 120_000,
        intervals: [1000, 2000, 3000],
      })
      .toBe(true);
    const found = await reviewed();
    if (!found?.theirs.review) throw new Error("the review is gone again");
    const { pool, item, section, theirs } = found;
    const sent = theirs.review as Sent;
    const committee = (await stored(chair, SANDBOX)).config.reviewPools.find(
      (x) => x.key === pool.key,
    );
    if (!committee) throw new Error("the sandbox has no such committee");
    const name = theirs.displayName ?? theirs.email;

    await chair.goto(`/en/c/${SANDBOX}/assignments`);
    await expect(chair.getByRole("heading", { level: 1, name: "Assignments" })).toBeVisible();
    // The Assignments page says how many reviews of the proposal were sent, beside its reviewers.
    const part = chair.getByRole("region", { name: committee.name.en ?? "", exact: true });
    const open = chair.locator(`[id="proposal-${item.id}"]`);
    while ((await open.count()) === 0) {
      const shown = await part.locator("ul.cards > li").count();
      await part.getByRole("button", { name: "Show more" }).click();
      await expect(part.locator("ul.cards > li")).not.toHaveCount(shown);
    }
    const card = part.locator("ul.cards > li").filter({ has: open });
    await expect(card.getByText(`Reviews sent: ${item.sent}`, { exact: true })).toBeVisible();
    await expect(
      card.getByText(`Reviewers: ${item.reviewers.length} of ${pool.needed}`, { exact: true }),
    ).toBeVisible();
    await expectAccessibleInBothThemes(chair);

    // On the proposal's page: who reviews it, whether each review is sent and when, and each
    // sent review in full.
    await open.click();
    await expect(chair).toHaveURL(new RegExp(`/en/s/${item.id}#reviewers$`));
    const reviewers = chair.getByRole("region", { name: "Reviewers" });
    await expect(reviewers.getByRole("heading", { level: 2, name: "Reviewers" })).toBeFocused();
    await expect(
      reviewers.getByText(
        "A review appears here once its reviewer has sent it, with who wrote it. The authors are never told who reviewed.",
      ),
    ).toBeVisible();
    const reviewing = reviewers.getByRole("list", { name: "Reviewers", exact: true });
    await expect(reviewing.locator("> li")).toHaveCount(section.assigned.length);
    const mine = reviewing.locator("> li").filter({ hasText: REVIEWER });
    // It was sent, and changed since: the page says both, with the times.
    expect(sent.changedAt, "the review was changed after it was first sent").toBeTruthy();
    await expect(mine.getByText(/^Review sent .+, last changed .+\.$/)).toBeVisible();
    const read = mine.getByRole("group", { name: `Review by ${name}` });
    const row = (label: string) =>
      read.locator("dl > div").filter({ hasText: label }).locator("dd");
    for (const criterion of committee.criteria) {
      await expect(row(criterion.label.en ?? "")).toHaveText(
        `${sent.scores[criterion.key]} of ${criterion.max}`,
      );
    }
    // As review.spec.ts left it: the first criterion at the top of its scale, accepted, with
    // the final comments and no note for the chairs.
    const top = committee.criteria[0];
    if (!top) throw new Error("the committee has no criterion");
    expect(sent.scores[top.key]).toBe(top.max);
    await expect(row("Recommendation")).toHaveText("Accept");
    await expect(row("Comments for the authors")).toHaveText(FINAL);
    await expect(row("Note for the chairs only")).toHaveText("None.");
    // A sent review is part of the proposal's record: its reviewer is not removed, and the
    // page says why in place of the button. The server refuses it all the same.
    await expect(
      mine.getByText(
        "Cannot be removed from this proposal: their review was sent, and a sent review is part of the proposal's record.",
      ),
    ).toBeVisible();
    await expect(mine.getByRole("button")).toHaveCount(0);
    const refused = await chair.request.delete(
      `/api/conferences/${SANDBOX}/assignments/submissions/${item.id}/reviewers/${theirs.personId}`,
      { headers: { origin: new URL(chair.url()).origin }, data: {} },
    );
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toEqual({ error: "review_sent" });
    // Whoever has sent nothing is shown so, whether or not they have begun, and can be removed.
    for (const other of section.assigned.filter((a) => a.email !== REVIEWER && !a.review)) {
      const theirRow = reviewing.locator("> li").filter({ hasText: other.email });
      await expect(theirRow.getByText("No review sent yet.")).toBeVisible();
      await expectTouchTarget(
        theirRow.getByRole("button", {
          name: `Remove from this proposal: ${other.displayName ?? other.email}`,
        }),
      );
    }
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 360, height: 740 });
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 390, height: 844 });

    // The proposal reviewer-30 gave back: its page lists them among those who said they could
    // not review it, with their reason and their note. It is found by that note: it is no
    // longer theirs, so nothing else points to it.
    let back: { id: string; section: Section } | null = null;
    for (const candidate of (await listed()).pools.find((x) => x.key === pool.key)?.items ?? []) {
      if (candidate.reviewers.some((r) => r.email === REVIEWER)) continue;
      const its = await sectionOf(candidate.id);
      if (its.declined.some((d) => d.email === REVIEWER && d.note === GIVEN_BACK)) {
        back = { id: candidate.id, section: its };
        break;
      }
    }
    if (!back) throw new Error("no proposal that reviewer-30 gave back with that note");
    // No time is no conflict: they can be assigned to it again.
    expect(back.section.candidates.map((c) => c.email)).toContain(REVIEWER);
    await chair.goto(`/en/s/${back.id}#reviewers`);
    const could = chair
      .getByRole("region", { name: "Reviewers" })
      .getByRole("list", { name: "Said they could not review it" });
    const said = could.locator("> li").filter({ hasText: REVIEWER });
    await expect(said).toContainText(name);
    await expect(said.getByText(/^They do not have the time\. Said so .+\.$/)).toBeVisible();
    await expect(said.getByText(`Their note for the chairs: ${GIVEN_BACK}`)).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);

    // Sent reviews stay valid: a largest score below one already given is refused in the
    // review of the changes, beside the value, with how many reviews it would leave outside
    // the scale. Nothing is saved, and the value is taken back.
    await chair.goto(`/en/c/${SANDBOX}/settings`);
    await expect(
      chair.getByRole("heading", { level: 1, name: "Conference settings" }),
    ).toBeVisible();
    const settings = await openPool(chair, committee.name.en ?? "");
    const largest = settings
      .getByRole("group", { name: `Criterion: ${top.label.en}` })
      .getByLabel("Largest score");
    await expect(largest).toHaveValue(String(top.max));
    await largest.fill(String(top.max - 1));
    await chair.getByRole("button", { name: "Review changes" }).click();
    const summary = chair.getByRole("alert").filter({ hasText: "Please fix the following" });
    await expect(summary).toBeFocused();
    // How many reviews that is, the chair can count on the proposals' pages: every sent review
    // of this committee that gives the criterion its largest score. Reviewer-30's is one of
    // them; an attempt of review.spec.ts that was run again leaves a second.
    let above = 0;
    for (const candidate of (await listed()).pools.find((x) => x.key === pool.key)?.items ?? []) {
      if (candidate.sent < 1) continue;
      for (const reviewer of (await sectionOf(candidate.id)).assigned) {
        if (reviewer.review?.scores[top.key] === top.max) above += 1;
      }
    }
    expect(above).toBeGreaterThanOrEqual(1);
    const why = `Reviews already sent that give a higher score than this: ${above}. A review that was sent stays valid, so the largest score cannot go below a score already given.`;
    await expect(summary).toContainText(
      `${committee.name.en} · ${top.label.en} · Largest score: ${why}`,
    );
    await expect(largest).toHaveAttribute("aria-invalid", "true");
    await expect(largest).toHaveAccessibleDescription(new RegExp(`${why.replace(/[.]/g, "\\.")}$`));
    await expect(chair.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await largest.fill(String(top.max));
    await expect(chair.getByText(/^Values changed and not saved yet/)).toHaveCount(0);
    await expect.poll(() => unsavedValues(chair)).toBeNull();
    expect(
      (await stored(chair, SANDBOX)).config.reviewPools.find((x) => x.key === pool.key)?.criteria[0]
        ?.max,
    ).toBe(top.max);
  });
});
