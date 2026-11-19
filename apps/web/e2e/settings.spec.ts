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
 * (the length of a reading or performance, the day decisions are sent, a pool's guidelines and
 * the label of one criterion) and put it back. No blind mode is ever saved: other tests read
 * who is shown to reviewers.
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

/** The collapsible section of a review pool, by the pool's name; opened if it is closed. */
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
        "Formats, fields, languages, review pools and criteria are added or removed by importing a configuration on the server, not here.",
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

    // A deadline is a date, a time and an offset, each as stored. Changing the date leaves the
    // other two alone, and the line below says which instant it now is.
    const decisions = chair.getByRole("group", { name: "Decisions sent" });
    const date = decisions.getByLabel("Date");
    const before = await date.inputValue();
    const time = await decisions.getByLabel("Time").inputValue();
    const after = new Date(Date.parse(`${before}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    await date.fill(after);
    await expect(decisions.getByLabel("Time")).toHaveValue(time);
    await expect(decisions.getByLabel("Offset from UTC")).toHaveValue("+00:00");
    await expect(decisions).toContainText(
      `${shownInBogota(`${after}T${time}:00Z`)} · Conference time (America/Bogota)`,
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
    await expect(chair.locator(".timeline")).toContainText(shownInBogota(`${after}T${time}:00Z`));

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
    await page.getByRole("link", { name: "Submit a proposal" }).click();
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
    await chair.locator("summary", { hasText: "Workshop" }).click();
    const workshop = chair
      .locator("details")
      .filter({ has: chair.locator("summary", { hasText: "Workshop" }) });
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
});
