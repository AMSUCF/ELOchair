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
 * the label of one criterion, the end of the Spanish invitation, and the Portuguese wording of
 * the notice about a deleted draft) and put it back. The tests that read the invitation on the
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
      criteria: { key: string; label: Record<string, string>; min: number; max: number }[];
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
      "An anonymized review stays anonymized once reviewers are assigned: after that, it can no longer be changed to show the authors.",
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
      "Reviewers are already assigned to proposals that are reviewed anonymized here. They and the authors were told that the review is anonymized, so the authors cannot be shown now.";
    await expect(summary).toContainText(`${poolName} · How authors appear to reviewers: ${why}`);
    await expect(modes.locator(".field-error")).toHaveText(why);
    for (const radio of await modes.getByRole("radio").all()) {
      await expect(radio).toHaveAttribute("aria-invalid", "true");
      // Each choice says the rule, then why this change is refused.
      await expect(radio).toHaveAccessibleDescription(
        `An anonymized review stays anonymized once reviewers are assigned: after that, it can no longer be changed to show the authors. ${why}`,
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
});
