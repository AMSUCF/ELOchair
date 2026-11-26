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
 * the label of one criterion, the end of the Spanish invitation and of the Spanish sentence
 * that introduces the formats, the Portuguese wording of the notice about a deleted draft,
 * and the wording and limits of one pool's review form with the day reviews are due) and
 * put it back. The tests that read the invitation on the front page, or that sentence on
 * the conference's page, read the Spanish one by its beginning. No blind mode is ever saved: other tests read who is shown to reviewers. Of the
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
  // The sign-in email, by its kind: other email may reach the same address meanwhile.
  const mail = await request.get(
    `/api/_test/outbox/latest?kind=magic_link&to=${encodeURIComponent(email)}`,
  );
  const code = /\b(\d{4}) (\d{4})\b/.exec(((await mail.json()) as { text: string }).text);
  await page.getByLabel("Code from the email").fill(`${code?.[1]}${code?.[2]}`);
  await page.getByRole("button", { name: "Sign in with code" }).click();
  await expect(page).toHaveURL(/\/en\/me$/);
}

/**
 * Sign in on a chairs' page itself, with the code from the email (spec 02, §1.11): signed out,
 * "Manage submissions" has the sign-in form on it, and once the code is typed it shows the
 * conference's submissions, without a reload and without going anywhere.
 *
 * It takes the place of the sign-in on the sign-in page that this file made anyway: the server
 * rations them, and the suite is close to the limit.
 */
async function signInOnManage(page: Page, request: APIRequestContext, email: string) {
  const here = "/en/c/sandbox/manage";
  await page.goto(here);
  const heading = page.getByRole("heading", { level: 1, name: "Manage submissions" });
  await expect(heading).toBeVisible();
  // Nobody is signed in: the page asks for that, and does not say "You do not chair".
  await expect(
    page.getByText("Sign in to open this page. It is for the chairs of this conference."),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Download proposals (CSV)" })).toHaveCount(0);
  await expectAccessibleInBothThemes(page);
  await expectNoHorizontalScroll(page);

  // The link in the email would lead back here: the request names this page.
  const asked = page.waitForRequest("**/api/auth/request-link");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  expect((await asked).postDataJSON()).toEqual({ email, lang: "en", next: here });
  await expect(page.getByText("Check your email.")).toBeVisible();
  // The sign-in email, by its kind: other email may reach the same address meanwhile.
  const mail = await request.get(
    `/api/_test/outbox/latest?kind=magic_link&to=${encodeURIComponent(email)}`,
  );
  const code = /\b(\d{4}) (\d{4})\b/.exec(((await mail.json()) as { text: string }).text);
  await page.getByLabel("Code from the email").fill(`${code?.[1]}${code?.[2]}`);
  await page.getByRole("button", { name: "Sign in with code" }).click();

  // Signed in, on the same page, which now shows what a chair comes for. Its heading takes
  // the focus, as after a navigation.
  await expect(page.getByRole("link", { name: "Download proposals (CSV)" })).toBeVisible();
  await expect(page).toHaveURL(here);
  await expect(heading).toBeFocused();
  await expect(page.getByLabel("Email address")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Conference settings" })).toBeVisible();
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
    rules: { reviewReminderDays?: number };
    distinction?: Record<string, string>;
    invitation?: Record<string, string>;
    formatsIntro?: Record<string, string>;
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

/**
 * The format's panel on the public page of the call. That page shows one format at a time, so
 * the format is chosen first.
 */
async function shownFormat(page: Page) {
  const chooser = page.getByRole("combobox", { name: "Format", exact: true });
  const key = await chooser.locator("option", { hasText: FORMAT }).getAttribute("value");
  await chooser.selectOption(key ?? "");
  const panel = page.locator(".format-panel");
  await expect(panel.getByRole("heading", { level: 3, name: FORMAT })).toBeVisible();
  return panel;
}

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
    // Changed with spec 02, §1.11: the chair used to sign in on the sign-in page, and land on
    // "Your account". They now sign in on a page of the conference they chair.
    await signInOnManage(chair, request, "chair@example.org");
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
    await expect(await shownFormat(chair)).toContainText("320 words at most");
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
    await expect(await shownFormat(chair)).toContainText("300 words at most");
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
    // The page asks for the format first: one row to a format, and pressing one chooses it.
    await page
      .getByRole("list", { name: "Format" })
      .getByRole("button", { name: new RegExp(`^${FORMAT} · `) })
      .click();
    await page.getByRole("radio", { name: "In person" }).check();
    await page.getByRole("button", { name: /^Start: / }).click();
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
    expect(await (await page.request.get("/api/me/menu")).json()).toMatchObject({
      submissions: true,
      reviews: false,
    });
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
    await expect(await shownFormat(chair)).toContainText("300 words at most");
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
    await expect(await shownFormat(chair)).toContainText("300 words at most");
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
    await chair.locator(".site-header").getByRole("link", { name: "Your account" }).click();
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

  test("a chair adds to the invitation and to the sentence about the formats, the public pages say it, and it is put back", async () => {
    test.slow();
    // Whatever the call says now: the test reads it, adds a sentence to the end of the Spanish
    // invitation, and to the end of the Spanish sentence that introduces the formats, and takes
    // both away again.
    const before = await stored(chair, CALL);
    const english = before.config.invitation?.en ?? "";
    const was = before.config.invitation?.es ?? "";
    const way = before.config.contributionGroups[0];
    if (!english || !was || !way) throw new Error("the call has no invitation to reword");
    const added = `${was} (Frase de prueba.)`;
    const introEnglish = before.config.formatsIntro?.en ?? "";
    const introWas = before.config.formatsIntro?.es ?? "";
    if (!introEnglish || !introWas) throw new Error("the call has no sentence about its formats");
    const introAdded = `${introWas} (Otra frase de prueba.)`;

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
    // The sentence that introduces the formats is beside them, with its own hint.
    const intro = chair.getByRole("group", { name: "Introduction to the formats", exact: true });
    const introSpanish = intro.getByLabel("Introduction to the formats (Español)");
    await expect(intro.getByLabel("Introduction to the formats (English)")).toHaveValue(
      introEnglish,
    );
    await expect(introSpanish).toHaveValue(introWas);
    await expect(introSpanish).toHaveAccessibleDescription(
      /^Optional\. A sentence or two, shown on the conference page above its submission formats/,
    );
    await expectTouchTarget(introSpanish);

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
    await introSpanish.fill(introAdded);
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
    await expect(review).toContainText("Invitation (Español)");
    await expect(review).toContainText("(Frase de prueba.)");
    await expect(review).toContainText("Introduction to the formats (Español)");
    await expect(review).toContainText("(Otra frase de prueba.)");
    await chair.getByRole("button", { name: "Save changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Settings saved.");
    const saved = (await stored(chair, CALL)).config;
    expect(saved.invitation).toEqual({ ...before.config.invitation, es: added });
    expect(saved.formatsIntro).toEqual({ ...before.config.formatsIntro, es: introAdded });

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
    // Above its formats that page has the sentence about them: in English, and in Spanish as
    // its echo; and the other way round in Spanish.
    await expect(chair.locator(".formats-intro")).toContainText(introEnglish);
    await expect(chair.locator(".formats-intro .echo")).toHaveText(introAdded);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.goto(`/es/c/${CALL}`);
    await expect(chair.locator(".formats-intro")).toContainText(introAdded);
    await expect(chair.locator(".formats-intro .echo")).toHaveText(introEnglish);

    // Checked here because this file has someone signed in, and the start page shows its form
    // only to them: "Start this proposal" in a format's panel begins the form with that format,
    // and the person may still choose another. Nothing is started. (Changed with the start
    // page: the format is no longer one of a group of radio buttons that are all on the page.
    // The form says which format it is for, and "Choose another format" brings the list.)
    const types = before.config.submissionTypes;
    const [firstFormat, lastFormat] = [types[0], types.at(-1)];
    if (!firstFormat || !lastFormat || firstFormat === lastFormat) {
      throw new Error("the call has fewer than two formats");
    }
    await chair.goto(`/en/c/${CALL}`);
    await chair.getByRole("combobox", { name: "Format", exact: true }).selectOption(lastFormat.key);
    const startThis = chair
      .locator(".format-panel")
      .getByRole("link", { name: "Start this proposal", exact: true });
    await expectTouchTarget(startThis);
    await startThis.click();
    await expect(chair).toHaveURL(new RegExp(`/en/c/${CALL}/submit\\?format=${lastFormat.key}$`));
    await expect(chair.getByRole("heading", { level: 1, name: "Start a proposal" })).toBeFocused();
    const chosen = chair.getByRole("group", { name: "Format" });
    const formatList = chair.getByRole("list", { name: "Format" });
    const called = (format: { name: Record<string, string> }) =>
      new RegExp(`^${(format.name.en ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · `);
    await expect(chosen.getByText(`Selected format: ${lastFormat.name.en}`)).toBeVisible();
    await expect(chair.getByRole("button", { name: `Start: ${lastFormat.name.en}` })).toBeVisible();
    await expect(formatList).toHaveCount(0);
    await chosen.getByRole("button", { name: "Choose another format" }).click();
    await expect(formatList.locator('[aria-current="true"]')).toHaveAccessibleName(
      called(lastFormat),
    );
    await formatList.getByRole("button", { name: called(firstFormat) }).click();
    await expect(chosen.getByText(`Selected format: ${firstFormat.name.en}`)).toBeFocused();
    await expect(
      chair.getByRole("button", { name: `Start: ${firstFormat.name.en}` }),
    ).toBeVisible();
    // An address that names no format of the call chooses none, and the page asks for one.
    // (It used to begin with the first.)
    await chair.goto(`/en/c/${CALL}/submit?format=no_such_format`);
    await expect(chair.getByText("Choose a format for your proposal.")).toBeVisible();
    await expect(formatList.getByRole("button")).toHaveCount(types.length);
    await expect(formatList.locator('[aria-current="true"]')).toHaveCount(0);
    await expect(chair.getByRole("button", { name: /^Start: / })).toHaveCount(0);

    // Back exactly as it was, for the tests that run beside this one.
    await openSettings(chair);
    await chair
      .getByRole("group", { name: "Invitation", exact: true })
      .getByLabel("Invitation (Español)")
      .fill(was);
    await chair
      .getByRole("group", { name: "Introduction to the formats", exact: true })
      .getByLabel("Introduction to the formats (Español)")
      .fill(introWas);
    await reviewAndSave(chair);
    const after = await stored(chair, CALL);
    expect(after.config.invitation).toEqual(before.config.invitation);
    expect(after.config.formatsIntro).toEqual(before.config.formatsIntro);
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
    // Accepting signed nobody in. Changed with spec 02, §1.11: the page used to link to the
    // sign-in page, with the invited address handed over. It now has the sign-in form on it,
    // with that address filled in.
    expect((await invitee.request.get("/api/me")).status()).toBe(401);
    await expect(invitee.locator('main a[href$="/sign-in"]')).toHaveCount(0);
    await expect(invitee.getByLabel("Email address")).toHaveValue(email);
    const emailMe = invitee.getByRole("button", { name: "Email me a link" });
    await expectTouchTarget(emailMe);
    await expectAccessibleInBothThemes(invitee);
    await expectNoHorizontalScroll(invitee);
    // The link it asks for leads to "Your account", never back to this page, which is nothing
    // without its token: the request names no address, and nothing of the invitation's link.
    // Both requests are answered here, and reach no server.
    let asked: unknown;
    await invitee.route("**/api/auth/request-link", (route) => {
      asked = route.request().postDataJSON();
      return route.fulfill({ status: 202, json: { ok: true } });
    });
    await emailMe.click();
    await expect(invitee.getByText("Check your email.")).toBeVisible();
    expect(asked).toEqual({ email, lang: "en" });
    // With the code the person is signed in on this page, and it carries on: what was answered
    // stays, and the form gives way to a line that says who is signed in, which takes focus.
    await invitee.route("**/api/auth/verify-code", (route) =>
      route.fulfill({ status: 200, json: { person: { email } } }),
    );
    await invitee.getByLabel("Code from the email").fill("1234 5678");
    await invitee.getByRole("button", { name: "Sign in with code" }).click();
    const signedIn = invitee.getByText(`You are signed in as ${email}.`);
    await expect(signedIn).toBeFocused();
    await expect(invitee).toHaveURL(/\/en\/role-invitation$/);
    await expect(invitee.getByLabel("Email address")).toHaveCount(0);
    await expect(status).toHaveText(
      `Thank you: ${email} is now a reviewer for ${title}. You can sign in with that address at any time.`,
    );
    await expect(
      invitee.getByRole("heading", { level: 1, name: "You are invited to review" }),
    ).toBeVisible();
    await expectAccessibleInBothThemes(invitee);
    await invitee.unroute("**/api/auth/request-link");
    await invitee.unroute("**/api/auth/verify-code");

    // That line names a person. When another tab of the browser says that nobody is signed in
    // any more (said here without a sign-out: nobody was signed in for it), the line goes and
    // the form is as it first was (spec 02, §1.13). The page did not start again, which would
    // have lost its link's token and what was answered: it carries on.
    const elsewhere = await invitee.context().newPage();
    await elsewhere.goto("/en/");
    await elsewhere.evaluate(() => {
      new BroadcastChannel("elochair:session").postMessage({
        what: "elochair:session",
        email: null,
      });
    });
    await expect(signedIn).toHaveCount(0);
    await expect(invitee.getByLabel("Email address")).toHaveValue(email);
    await expect(invitee.getByText("Check your email.")).toHaveCount(0);
    await expect(status).toHaveText(
      `Thank you: ${email} is now a reviewer for ${title}. You can sign in with that address at any time.`,
    );
    await elsewhere.close();

    // The link was used: opened again, it gives a plain page and nothing else, not even a role.
    // (From another page: the invitee is still on the invitation's, and the same address with
    // another fragment would not load it again.)
    await invitee.goto("/en/");
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
    // Someone who declined is offered no sign-in (the form, where it used to be a link). The
    // page offers none, that is: "Sign in" in the header is there for whoever is signed out.
    await expect(invitee.getByLabel("Email address")).toHaveCount(0);
    await expect(invitee.getByRole("main").getByRole("link", { name: /Sign in/ })).toHaveCount(0);
    await expect(
      invitee.locator(".site-header").getByRole("link", { name: "Sign in" }),
    ).toBeVisible();
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
        "The app sends these emails to the people on a proposal, to the people a chair invites as reviewers or chairs, to reviewers and chairs while proposals are reviewed, and to a proposal's authors when the chairs send the decisions.",
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
   * The four emails of the review phase (spec 03, §1.7) are messages like the others: the
   * Emails section offers each, with when it is sent and to whom. Nothing is saved here.
   */
  test("the emails of the review phase are among the emails a chair can reword, each with when it is sent and to whom", async () => {
    test.slow();
    await openSettings(chair);
    const often =
      "an email for each one, one summary a day (from 8:00 in the conference's time zone), or none";
    for (const [name, when, placeholders] of [
      [
        "New assignments, to a reviewer",
        `Sent to a reviewer when a chair assigns proposals to them while the conference is in review, and for proposals assigned earlier once it is: ${often}, as that reviewer chose under “Your account”. It says how many proposals and never which: it names no proposal and no author.`,
        ["{count}", "{conference}", "{due}", "{link}", "{choices}"],
      ],
      [
        "Reminder before reviews are due, to a reviewer",
        "Sent to each reviewer who has reviews that are not sent, from 8:00 in the conference's time zone, some days before the day reviews are due: 3 days, unless you set another number among the deadlines. Sent once for the day you set. Not sent while no day is set, and not to a reviewer who turned reminders off under “Your account”.",
        ["{count}", "{conference}", "{due}", "{link}", "{choices}"],
      ],
      [
        "A reviewer cannot review a proposal, to the chairs",
        `Sent to the conference's chairs when a reviewer says they cannot review a proposal and gives it back: ${often}, as each chair chose under “Your account”. It names no proposal and no reviewer: who gave it back is on the proposal's page. A chair gets none about their own proposal or one they have a conflict with.`,
        ["{count}", "{reason}", "{conference}", "{link}", "{choices}"],
      ],
      [
        "A proposal has all its reviews, to the chairs",
        `Sent to the conference's chairs when a proposal has as many sent reviews as its committee asks for: ${often}, as each chair chose under “Your account”. It names no proposal. A chair gets none about their own proposal or one they have a conflict with.`,
        ["{count}", "{conference}", "{link}", "{choices}"],
      ],
    ] as const) {
      const section = await openPool(chair, name);
      await expect(section.locator("p.meta").first()).toHaveText(when);
      await expect(section.locator(".placeholders dt")).toHaveText([...placeholders]);
      // Both links must be in a text, and neither can go in a subject.
      for (const link of ["{link}", "{choices}"]) {
        await expect(
          section
            .locator(".placeholders dl > div")
            .filter({ has: chair.locator("dt", { hasText: link }) })
            .locator("strong"),
        ).toHaveText("The text must contain it, and it cannot go in the subject.");
      }
    }

    // New assignments: the standard text is in the boxes, and the preview is the email as it
    // would be sent, with a number, the real addresses, and what it says of the day reviews are
    // due (the call has none set).
    const assigned = await openPool(chair, "New assignments, to a reviewer");
    await expect(assigned.locator(".placeholders dd")).toHaveText([
      "how many proposals were newly assigned to the reviewer",
      "the conference's title",
      "a sentence that says when reviews are due, or that the chairs have set no day",
      "the link to the reviewer's list, “My reviews”The text must contain it, and it cannot go in the subject.",
      "the link to the person's own choices about these emails, under “Your account”The text must contain it, and it cannot go in the subject.",
    ]);
    const english = assigned.getByRole("group", { name: "English" });
    await expect(english.getByLabel("Subject (English)")).toHaveValue(
      "{conference}: proposals assigned to you for review",
    );
    const origin = new URL(chair.url()).origin;
    await expect(english.locator(".email-body")).toContainText(
      `Newly assigned: 3\nThe chairs have not set a day when reviews are due.\n\nYour list is here, with each proposal and its review form:\n\n${origin}/en/reviews\n\n`,
    );
    await expect(english.locator(".email-body")).toContainText(
      /You are getting this email because you review for .+\. To get these emails less often, or not at all, change your choices under "Your account":\n\nhttp[^\n]+\/en\/me#emails$/,
    );
    await expect(english.getByText("This is the standard text.")).toBeVisible();
    // A text that leaves out the link to the reader's choices, or names a proposal's title, is
    // refused where it is typed.
    const body = english.getByLabel("Text (English)");
    const standard = await body.inputValue();
    await body.fill("{count} new proposals:\n\n{link}");
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(english.locator(".field-error")).toContainText("The text must contain {choices}.");
    await body.fill("{title}\n\n{link}\n\n{choices}");
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(english.locator(".field-error")).toContainText(
      "This email has nothing to put in place of {title}.",
    );
    await body.fill(standard);
    await expect(english.getByText("This is the standard text.")).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);

    // A proposal given back: the reasons are the app's own words, listed for whoever rewords.
    const declined = await openPool(chair, "A reviewer cannot review a proposal, to the chairs");
    const reason = declined
      .locator(".placeholders dl > div")
      .filter({ has: chair.locator("dt", { hasText: "{reason}" }) });
    await expect(reason.locator("dd")).toContainText(
      "why the reviewer cannot review it; in a summary, each reason that was given",
    );
    await expect(reason.locator("dd")).toContainText(
      "English: a conflict of interest · outside what they can judge · no time",
    );
    await expect(
      declined.getByRole("group", { name: "English" }).locator(".email-body"),
    ).toContainText(`Reason given: no time\n`);
    await expect(
      declined.getByRole("group", { name: "English" }).locator(".email-body"),
    ).toContainText(`${origin}/en/c/${CALL}/assignments\n`);
    // Nothing was changed: nothing is kept in this browser.
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Nothing has been changed.");
    await expect.poll(() => unsavedKeys(chair)).toEqual([]);

    // In Spanish and in Portuguese, each has its name and its line.
    for (const [lang, names, line] of [
      [
        "es",
        [
          "Nuevas asignaciones, para quien revisa",
          "Recordatorio antes de la entrega de las revisiones, para quien revisa",
          "Alguien no puede revisar una propuesta, para la presidencia",
          "Una propuesta tiene todas sus revisiones, para la presidencia",
        ],
        "Se envía a quien revisa cuando alguien de la presidencia le asigna propuestas",
      ],
      [
        "pt",
        [
          "Novas atribuições, para quem revê",
          "Lembrete antes da entrega das revisões, para quem revê",
          "Alguém não pode rever uma proposta, para a presidência",
          "Uma proposta tem todas as revisões, para a presidência",
        ],
        "É enviado a quem revê quando alguém da presidência lhe atribui propostas",
      ],
    ] as const) {
      await chair.goto(`/${lang}/c/${CALL}/settings`);
      for (const name of names) {
        await expect(chair.locator("summary", { hasText: name })).toHaveCount(1);
      }
      const section = chair
        .locator("details")
        .filter({ has: chair.locator("summary", { hasText: names[0] }) });
      await section.locator("summary").click();
      await expect(section.locator("p.meta").first()).toContainText(line);
      await expect(section.locator(`.email-body[lang="${lang}"]`)).toContainText(
        `${origin}/${lang}/me#emails`,
      );
      await expectNoHorizontalScroll(chair);
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
        "Every proposal that can be given reviewers, under the committee that reviews it. Those that still need reviewers come first, then those still waiting for reviews. To assign or remove a reviewer, or to read the reviews that were sent, open the proposal. Nothing is assigned automatically.",
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
      early.getByText(
        /will be able to read this proposal once the conference is in review, .+\. They are told by email once it is, as often as they have chosen\. Nobody is emailed when you remove one\.$/,
      ),
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
      // What assigning does, in a sentence, and who is told of it by email.
      await expect(
        section.getByText(
          /^A reviewer you assign here can read this proposal from then on, (anonymized: without the authors' names|with the authors' names and affiliations)\. They are told by email, as often as they have chosen\. Nobody is emailed when you remove one\.$/,
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
      await expect(said).toHaveText(`${name} is now a reviewer of this proposal.`);
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
  test("a chair words the review form, sets its limits, the day reviews are due and the days before the reminder, and puts it all back", async () => {
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
    // Right after it, how many days before that day reviewers are reminded: three, unless the
    // chairs set another number.
    expect(before.config.rules).not.toHaveProperty("reviewReminderDays");
    const remind = chair.getByLabel("Reminder to reviewers: days before reviews are due");
    await expect(remind).toHaveValue("");
    await expect(remind).toHaveAccessibleDescription(
      "Optional. Left empty, it is 3 days. That many days before the day reviews are due, from 8:00 in the conference's time zone, each reviewer who still has reviews to send gets one email, unless they turned it off. No reminder is sent while no day is set. If you move the day afterwards, reviewers are reminded again before the new one, unless the reminder for that day has already gone out.",
    );
    await expectTouchTarget(remind);
    // Between the day reviews are due and the day decisions are sent.
    expect(
      await remind.evaluate((el) => {
        const after = (id: string) =>
          Boolean(
            (document.getElementById(id)?.compareDocumentPosition(el) ?? 0) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          );
        return [after("field-deadlines-reviewsDue"), after("field-deadlines-notification")];
      }),
    ).toEqual([true, false]);
    await remind.fill("5");

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
    await expect(chair.getByText("Values changed and not saved yet: 7.")).toBeVisible();
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
    await expect(review.getByRole("listitem")).toHaveCount(7);
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
    await changed("Reminder to reviewers: days before reviews are due", "empty", "5");
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
    expect(saved.rules.reviewReminderDays).toBe(5);
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
    await expect(remind).toHaveValue("5");
    await openPool(chair, poolName);
    await expect(described).toHaveValue(explained);
    await expect(fewest).toHaveValue("5");
    await expect(most).toHaveValue("400");
    await expect(hasNote).not.toBeChecked();

    // Back exactly as it was, for the tests that run beside this one: an emptied date takes
    // the day away, an emptied box its limit or its text.
    await dueGroup.getByLabel("Date").fill("");
    await expect(dueGroup.getByText("No day is set.")).toBeVisible();
    await remind.fill("");
    await described.fill("");
    await under.fill("");
    await fewest.fill("");
    await most.fill("");
    await hasNote.check();
    await reviewAndSave(chair);
    const after = await stored(chair, CALL);
    expect(after.config.deadlines).toEqual(before.config.deadlines);
    expect(after.config.rules).toEqual(before.config.rules);
    expect(after.config.reviewPools).toEqual(before.config.reviewPools);
    expect(after.token).toBe(before.token);
    await expect.poll(() => unsavedValues(chair)).toBeNull();
  });

  /*
   * The emails of the review phase, as a chair chooses them (spec 03, §1.7). The chair of these
   * tests chairs five conferences and reviews at one of them, `chair-reviews`: each part of the
   * choices is shown only where its role is held. What is changed is the chair's own choice at
   * `phase-room`, an empty conference where nothing ever happens to be told of, so that no
   * email follows from it. A second attempt finds what the first one left: the page is held
   * to what the server says, and the test chooses another.
   */
  test("a chair chooses how often they are told of what happens in the review, on Your account", async () => {
    type Choices = {
      conference: { slug: string; title: Record<string, string> };
      reviewer: { assignments: string; reminder: boolean; reminderDays: number } | null;
      chair: { notices: "each" | "daily" | "none" } | null;
    };
    const mine = async () =>
      (
        (await (await chair.request.get("/api/me/notifications")).json()) as {
          conferences: Choices[];
        }
      ).conferences;
    const before = await mine();
    const at = (list: Choices[], slug: string) => {
      const found = list.find((k) => k.conference.slug === slug);
      if (!found) throw new Error(`the chair has no email choices at ${slug}`);
      return found;
    };
    // A reviewer's choices only where the chair reviews; a chair's wherever they chair.
    expect(before.filter((k) => k.reviewer).map((k) => k.conference.slug)).toEqual([
      "chair-reviews",
    ]);
    for (const slug of ["chair-reviews", "decisions-room", CALL, "phase-room", "sandbox"]) {
      expect(at(before, slug).chair, slug).not.toBeNull();
    }
    const room = at(before, "phase-room");
    const both = at(before, "chair-reviews");
    const LABELS = {
      each: "An email for each one",
      daily: "One summary a day",
      none: "No email",
    } as const;

    await chair.goto("/en/me");
    await expect(chair.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
    const emails = chair.getByRole("region", { name: "Emails about reviewing" });
    const formOf = (k: Choices) =>
      emails.locator("form").filter({
        has: chair.getByRole("heading", {
          level: 3,
          name: k.conference.title.en ?? "",
          exact: true,
        }),
      });
    // Where they also review: the reviewer's two choices, then the chair's.
    const reviews = formOf(both);
    await expect(
      reviews.getByRole("group", { name: "When proposals are assigned to you" }).getByRole("radio"),
    ).toHaveCount(3);
    await expect(reviews.getByRole("checkbox")).toHaveAccessibleName(
      "Remind me 3 days before reviews are due",
    );
    await expect(
      reviews.getByRole("group", { name: "As a chair: notices about reviewing" }),
    ).toBeVisible();
    // Where they only chair: the chair's choice, and nothing about assignments or a reminder.
    const form = formOf(room);
    const notices = form.getByRole("group", { name: "As a chair: notices about reviewing" });
    await expect(
      notices.getByText(
        "When a reviewer cannot review a proposal, and when a proposal has all its reviews. A summary is one email for each of the two.",
      ),
    ).toBeVisible();
    await expect(notices.locator("label")).toHaveText([LABELS.each, LABELS.daily, LABELS.none]);
    await expect(
      notices.getByRole("radio", { name: LABELS[room.chair?.notices ?? "daily"] }),
    ).toBeChecked();
    await expect(
      form.getByRole("group", { name: "When proposals are assigned to you" }),
    ).toHaveCount(0);
    await expect(form.getByRole("checkbox")).toHaveCount(0);
    // What cannot be turned off is said once, under the heading: not again for each of the
    // five conferences this chair has.
    const always = emails.getByText(
      "Invitations, sign-in emails and the decisions about your own proposals are always sent: without them you could not take part.",
    );
    await expect(always).toHaveCount(1);
    await expect(always).toBeVisible();
    await expect(emails.locator("form")).toHaveCount(5);
    await expect(emails.locator("> *").nth(1)).toHaveText(
      "Invitations, sign-in emails and the decisions about your own proposals are always sent: without them you could not take part.",
    );
    await expect(form.getByText("Invitations, sign-in emails")).toHaveCount(0);
    const title = room.conference.title.en ?? "";
    const save = form.getByRole("button", { name: `Save email choices for ${title}` });
    for (const label of await notices.locator("label").all()) await expectTouchTarget(label);
    await expectTouchTarget(save);
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 360, height: 740 });
    await expectNoHorizontalScroll(chair);
    await chair.setViewportSize({ width: 390, height: 844 });

    // Another choice, saved: the page says so in that conference's own part, and it is kept.
    const next = room.chair?.notices === "each" ? "none" : "each";
    await notices.getByRole("radio", { name: LABELS[next] }).check();
    await save.click();
    await expect(form.getByRole("status")).toHaveText(`Your email choices for ${title} are saved.`);
    await expect(form.getByRole("status")).toBeFocused();
    const after = await mine();
    expect(at(after, "phase-room").chair).toEqual({ notices: next });
    // The others are as they were: each conference is saved by itself.
    for (const slug of ["chair-reviews", "decisions-room", CALL, "sandbox"]) {
      expect(at(after, slug), slug).toEqual(at(before, slug));
    }
    await chair.reload();
    await expect(notices.getByRole("radio", { name: LABELS[next] })).toBeChecked();

    // In Spanish and in Portuguese, the chair's part is in that language.
    for (const [lang, heading, legend] of [
      ["es", "Correos sobre la revisión", "Como parte de la presidencia: avisos sobre la revisión"],
      ["pt", "Emails sobre a revisão", "Como membro da presidência: avisos sobre a revisão"],
    ] as const) {
      await chair.goto(`/${lang}/me`);
      const part = chair.getByRole("region", { name: heading });
      await expect(part.getByRole("group", { name: legend })).toHaveCount(5);
      await expectNoHorizontalScroll(chair);
    }
  });

  /*
   * A new assignment is announced by email, as often as the reviewer chose (spec 03, §1.7).
   * `chair-reviews` is seeded with a second reviewer who asked for an email for each one and
   * has nothing assigned: nobody signs in as them, and no other test reads their mail or
   * assigns them anything. The chair assigns them one of that conference's talks, the job that
   * makes these emails is run at once (the test server has an address for that, so that nothing
   * waits for its timer), and the email is read from the test outbox. They are removed again:
   * the talk ends with the reviewers it had.
   */
  test("a chair assigns a proposal to a reviewer who wants an email for each one, and the email says how many and where", async () => {
    const ROOM = "chair-reviews";
    const REVIEWER = "chair-reviews-reviewer@example.org";
    const NAME = "Fictional Reviewer";
    type Holder = { personId: string; displayName: string | null; email: string };
    type Section = { assigned: Holder[]; candidates: Holder[] };
    const origin = new URL(chair.url()).origin;
    const sectionOf = async (id: string) =>
      (await (
        await chair.request.get(`/api/conferences/${ROOM}/assignments/submissions/${id}`)
      ).json()) as Section;
    const runJob = async () => {
      const res = await chair.request.get("/api/_test/notifications/run");
      expect(res.ok()).toBe(true);
      return (await res.json()) as { emails: number; reminders: number; dropped: number };
    };
    const latest = async () => {
      const res = await chair.request.get(
        `/api/_test/outbox/latest?kind=new_assignments&to=${encodeURIComponent(REVIEWER)}`,
      );
      return res.ok() ? ((await res.json()) as { subject: string; text: string }) : null;
    };
    // The last of the chair's own talks there, by id: whichever of them another test writes a
    // review of, nothing here changes it.
    const talks = (
      (await (await chair.request.get("/api/me/reviews")).json()) as {
        conferences: {
          conference: { slug: string };
          proposals: { submissionId: string; title: string }[];
        }[];
      }
    ).conferences.find((k) => k.conference.slug === ROOM)?.proposals;
    const talk = [...(talks ?? [])]
      .sort((a, b) => a.submissionId.localeCompare(b.submissionId))
      .at(-1);
    if (!talk) throw new Error("chair-reviews has no talk");
    let before = await sectionOf(talk.submissionId);
    // An earlier attempt of this test may have stopped with them still on the talk.
    const left = before.assigned.find((a) => a.email === REVIEWER);
    if (left) {
      await chair.request.delete(
        `/api/conferences/${ROOM}/assignments/submissions/${talk.submissionId}/reviewers/${left.personId}`,
        { headers: { origin }, data: {} },
      );
      before = await sectionOf(talk.submissionId);
    }
    if (!before.candidates.some((c) => c.email === REVIEWER)) {
      throw new Error("the second reviewer of chair-reviews is not offered");
    }
    // Whatever waited before this test is answered first: what follows is this assignment's.
    await runJob();
    const earlier = await latest();
    if (test.info().retry === 0) expect(earlier).toBeNull();

    await chair.goto(`/en/s/${talk.submissionId}#reviewers`);
    const section = chair.getByRole("region", { name: "Reviewers" });
    await expect(section.getByRole("heading", { level: 2, name: "Reviewers" })).toBeFocused();
    // The page says who is told by email, before anyone is assigned.
    await expect(
      section.getByText(
        "They are told by email, as often as they have chosen. Nobody is emailed when you remove one.",
        { exact: false },
      ),
    ).toBeVisible();
    const row = section
      .getByRole("list", { name: "Assign a reviewer" })
      .getByRole("listitem")
      .filter({ hasText: REVIEWER });
    await row.getByRole("button", { name: `Assign ${NAME} to this proposal` }).click();
    const said = section.getByRole("status").first();
    await expect(said).toHaveText(`${NAME} is now a reviewer of this proposal.`);
    // The job makes the email, at once for someone who chose one for each. (The server's own
    // timer may have made it a moment ago: either way it is in the outbox after this run.)
    await runJob();
    const mail = await latest();
    const conference = (await stored(chair, ROOM)).config.title.en ?? "";
    expect(mail?.subject).toBe(`${conference}: proposals assigned to you for review`);
    expect(mail?.text).toBe(
      [
        `The chairs of ${conference} have assigned proposals to you for review.`,
        "",
        "Newly assigned: 1",
        "The chairs have not set a day when reviews are due.",
        "",
        "Your list is here, with each proposal and its review form:",
        "",
        `${origin}/en/reviews`,
        "",
        `You are getting this email because you review for ${conference}. To get these emails less often, or not at all, change your choices under "Your account":`,
        "",
        `${origin}/en/me#emails`,
      ].join("\n"),
    );
    // It names no proposal and no person: not the talk, its author, or the chair.
    for (const hidden of [talk.title, "Fictional Author", "Fictional Chair", "chair@example.org"]) {
      expect(mail?.text).not.toContain(hidden);
    }

    // Removed again: the talk has the reviewers it had, and no email is made of a removal.
    const theirs = section
      .getByRole("list", { name: "Reviewers", exact: true })
      .getByRole("listitem")
      .filter({ hasText: REVIEWER });
    await theirs.getByRole("button", { name: `Remove from this proposal: ${NAME}` }).click();
    await theirs.getByRole("button", { name: "Yes, remove" }).click();
    await expect(said).toHaveText(`${NAME} was removed from this proposal. Nobody was emailed.`);
    await runJob();
    expect(await latest()).toEqual(mail);
    expect((await sectionOf(talk.submissionId)).assigned).toEqual(before.assigned);
  });

  /*
   * What the chairs are shown of a review (spec 03, §1.4). This file has the chair, and
   * review.spec.ts the reviewer, signed in once each: nobody signs in here.
   *
   * It is the one test that depends on another file. Reviewer-30 sends a review beside this
   * file, and the last thing they write is that review with the words of FINAL as its comments
   * (the rule is at the top of review.spec.ts). This test waits for exactly that, wherever it
   * was written, so that it reads a review nobody is still changing; before it, reviewer-30
   * has given one proposal back, with the note GIVEN_BACK. Only the two tests of decisions
   * follow it: run without review.spec.ts, nothing sends that review, this test fails for want
   * of it, and those two are not run.
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

  /*
   * Decisions (spec 03, §1.6). They are here because this file has a chair signed in, who
   * chairs `decisions-room` too: a small conference seeded in "Decisions in progress" for
   * these two tests, with five talks whose reviews were sent. Nobody signs in below, no
   * conference's phase is moved, and no other test reads that conference's proposals or the
   * mail of its made-up authors and reviewers.
   *
   * One of the five is the chair's own. It is kept from them as a chair: it is not on the
   * Decisions page, and a co-chair (seeded, nobody signs in as them) has recorded its decision.
   * It is counted when the decisions are sent, and once they are, the chair reads its decision
   * as its author: that is the author's page these tests look at, with the session the file has.
   *
   * The first test puts back everything it changes. The second sends decisions, which cannot
   * be undone: it is the last test of the file, so that a second attempt of an earlier test
   * (in a serial file all of them run again) never finds the decisions sent already.
   */
  const ROOM = "decisions-room";
  const TALKS = {
    two: "Decisions room: a talk with two reviews",
    one: "Decisions room: a talk with one review",
    waits: "Decisions room: a talk for the waiting list",
    none: "Decisions room: a talk nobody has reviewed",
    own: "Decisions room: the chair's own talk",
  };
  const AUTHORS = {
    first: "decisions-room-author-1@example.org",
    second: "decisions-room-author-2@example.org",
  };
  type Outcome = "accepted" | "waitlisted" | "rejected";
  type Waiting = Record<Outcome | "people" | "undecided" | "dropped", number> & {
    canSend: boolean;
    token: string;
  };
  type DecisionsList = {
    canRecord: boolean;
    canSend: boolean;
    excluded: number;
    pools: {
      key: string;
      proposals: number;
      undecided: number;
      items: { id: string; title: string; waitlisted: boolean; recorded: Outcome | null }[];
    }[];
  };
  const decisionsOf = async () =>
    (await (await chair.request.get(`/api/conferences/${ROOM}/decisions`)).json()) as DecisionsList;
  const waitingAt = async () =>
    (await (await chair.request.get(`/api/conferences/${ROOM}/decisions/send`)).json()) as Waiting;
  /** The id of one of the seeded talks the chair manages, by its title. */
  const talkId = async (title: string) => {
    const found = (await decisionsOf()).pools
      .flatMap((p) => p.items)
      .find((item) => item.title === title);
    if (!found) throw new Error(`${ROOM} does not list “${title}”`);
    return found.id;
  };
  /** The latest email of one kind to an address, or null: read from the test outbox. */
  const mailOf = async (kind: string, to: string) => {
    const res = await chair.request.get(
      `/api/_test/outbox/latest?kind=${kind}&to=${encodeURIComponent(to)}`,
    );
    return res.ok() ? ((await res.json()) as { subject: string; text: string }) : null;
  };
  /** One of the page's widths: nothing scrolls sideways at either. */
  const atBothWidths = async (check: () => Promise<void>) => {
    await check();
    await chair.setViewportSize({ width: 360, height: 800 });
    await check();
    await chair.setViewportSize({ width: 390, height: 844 });
  };
  /** Record a decision on a proposal's page, as a chair does: choose, press, read what it says. */
  const recordOnPage = async (id: string, choice: string, said: string) => {
    await chair.goto(`/en/s/${id}#decision`);
    const section = chair.getByRole("region", { name: "Decision" });
    await expect(section.getByRole("heading", { level: 2, name: "Decision" })).toBeFocused();
    await section.getByRole("radio", { name: choice, exact: true }).check();
    await section
      .getByRole("button", { name: /^(Record this decision|Change the decision)$/ })
      .click();
    await expect(section.getByRole("status")).toHaveText(said);
    return section;
  };

  test("a chair sees what awaits a decision, records one on the proposal's page, changes it and takes it back", async () => {
    test.slow();
    const origin = new URL(chair.url()).origin;
    const before = await decisionsOf();
    const waitingBefore = await waitingAt();
    // As it was seeded (or as a first attempt of this test left it): nothing recorded for the
    // four talks this chair manages, and the co-chair's decision for the chair's own.
    expect(before.pools[0]?.items.map((x) => [x.title, x.recorded])).toEqual([
      [TALKS.two, null],
      [TALKS.one, null],
      [TALKS.waits, null],
      [TALKS.none, null],
    ]);
    expect(waitingBefore).toMatchObject({ canSend: true, accepted: 1, waitlisted: 0, rejected: 0 });

    // From "Manage submissions" to the Decisions page.
    await chair.goto(`/en/c/${ROOM}/manage`);
    const link = chair.getByRole("link", { name: "Decisions", exact: true });
    await expectTouchTarget(link);
    await link.click();
    await expect(chair).toHaveURL(new RegExp(`/en/c/${ROOM}/decisions$`));
    // A new page: its heading takes focus.
    await expect(chair.getByRole("heading", { level: 1, name: "Decisions" })).toBeFocused();
    await expect(
      chair.getByText(
        "Every proposal that still awaits a decision, under the committee that reviews it. Those with no decision yet come first. To record a decision, open the proposal: its reviews are on the same page. Recording tells nobody. A proposal that was told “accepted” or “not accepted” is no longer listed here: find it on “Manage submissions”, by its status.",
      ),
    ).toBeVisible();
    // The chair's own talk is not listed, and the page says that one is not.
    await expect(
      chair.getByText("1 proposal is not listed: it is your own, or you have a conflict with it."),
    ).toBeVisible();
    await expect(chair.getByText(TALKS.own)).toHaveCount(0);

    // What waits to be sent is said at the top, with the step that sends it. It counts the
    // decision a co-chair recorded for the chair's own talk, and names nothing.
    const sending = chair.getByRole("region", { name: "Send the decisions" });
    await expect(
      sending.getByText(
        "Sending tells the authors. Every decision that is recorded and not sent yet goes out, for the whole conference: the proposal gets its new status, and its owner and confirmed co-authors get an email with the outcome and the reviewers' comments for the authors.",
      ),
    ).toBeVisible();
    await expect(
      sending.getByText("Waiting to be sent: 1 accepted, 0 for the waiting list, 0 not accepted."),
    ).toBeVisible();
    const open = sending.getByRole("button", { name: "Send the decisions" });
    await expectTouchTarget(open);

    // By committee: each proposal with its format, its reviews and what they recommend.
    const scientific = chair.getByRole("region", { name: "Scientific committee" });
    await expect(
      scientific.getByText("4 proposals await a decision. 4 have no decision yet."),
    ).toBeVisible();
    const cards = scientific.locator(".cards > li");
    await expect(cards.locator("h3")).toHaveText([TALKS.two, TALKS.one, TALKS.waits, TALKS.none]);
    const card = (title: string) => cards.filter({ hasText: title });
    await expect(card(TALKS.two)).toContainText("Individual talk");
    await expect(card(TALKS.two)).toContainText("No decision yet");
    await expect(card(TALKS.two)).toContainText("Reviews sent: 2 of 3 · 1 accept, 1 unsure");
    await expect(card(TALKS.one)).toContainText("Reviews sent: 1 of 3 · 1 reject");
    await expect(card(TALKS.none)).toContainText("No review was sent.");
    await expect(
      chair
        .getByRole("region", { name: "Artistic committee" })
        .getByText("No proposal of this committee awaits a decision."),
    ).toBeVisible();
    // No reviewer is named here, and nothing a reviewer wrote: that is on the proposal's page.
    await expect(chair.locator("main")).not.toContainText("Fictional First Reviewer");
    await expect(chair.locator("main")).not.toContainText("Made-up comments");
    await expectTouchTarget(card(TALKS.two).getByRole("link", { name: TALKS.two }));
    await expectAccessibleInBothThemes(chair);
    await atBothWidths(() => expectNoHorizontalScroll(chair));

    // The proposal's page: the decision above its reviewers, with what they recommend.
    const id = await talkId(TALKS.two);
    await card(TALKS.two).getByRole("link", { name: TALKS.two }).click();
    await expect(chair).toHaveURL(new RegExp(`/en/s/${id}#decision$`));
    const section = chair.getByRole("region", { name: "Decision" });
    await expect(section.getByRole("heading", { level: 2, name: "Decision" })).toBeFocused();
    await expect(
      section.getByText(
        "Recording a decision here tells nobody. The authors are told when the chairs send the decisions, on the Decisions page. Until then you can change it or take it back.",
      ),
    ).toBeVisible();
    await expect(
      section.getByText(
        "Reviews sent: 2 of 3. Recommendations: 1 accept, 1 unsure. The reviews themselves are under “Reviewers”, below.",
      ),
    ).toBeVisible();
    await expect(section.getByText("No decision is recorded for this proposal.")).toBeVisible();
    const choices = section.getByRole("group", { name: "Decision for this proposal" });
    await expect(choices.locator("label")).toHaveText([
      "Accept",
      "Put on the waiting list",
      "Reject",
    ]);
    for (const label of await choices.locator("label").all()) await expectTouchTarget(label);
    const record = section.getByRole("button", { name: "Record this decision" });
    await expectTouchTarget(record);
    await expect(section.getByRole("button", { name: "Take the decision back" })).toHaveCount(0);
    // The reviews are beside it, as they were: each one in full, under who wrote it.
    const reviewers = chair.getByRole("region", { name: "Reviewers" });
    await expect(
      reviewers.getByRole("group", { name: "Review by Fictional First Reviewer" }),
    ).toContainText("Made-up comments for the authors, number one.");
    await expectAccessibleInBothThemes(chair);
    await atBothWidths(() => expectNoHorizontalScroll(chair));

    // Nothing chosen: nothing is recorded, and the page says what to do.
    const said = section.getByRole("status");
    await record.click();
    await expect(said).toHaveText("Choose one of the decisions first.");
    await expect(said).toBeFocused();
    // Recorded: the page says so there, and that nobody was told.
    await choices.getByRole("radio", { name: "Reject" }).check();
    await record.click();
    await expect(said).toHaveText("Recorded: reject. Nobody was told.");
    await expect(said).toBeFocused();
    await expect(
      section.getByText(
        "Recorded, and not sent yet: reject. It is sent with the others, on the Decisions page.",
      ),
    ).toBeVisible();
    await expect(choices.getByRole("radio", { name: "Reject" })).toBeChecked();
    // Nobody was told indeed: the proposal reads "Submitted" as before, and no email was made.
    await expect(chair.locator("article .badge").first()).toHaveText("Submitted");
    for (const kind of ["decision_accepted", "decision_waitlisted", "decision_rejected"]) {
      expect(await mailOf(kind, AUTHORS.first), kind).toBeNull();
    }
    // Changed, by the same form.
    const change = section.getByRole("button", { name: "Change the decision" });
    const takeBack = section.getByRole("button", { name: "Take the decision back" });
    await expectTouchTarget(change);
    await expectTouchTarget(takeBack);
    await choices.getByRole("radio", { name: "Accept" }).check();
    await change.click();
    await expect(said).toHaveText("Recorded: accept. Nobody was told.");
    await expect(
      section.getByText("Recorded, and not sent yet: accept.", { exact: false }),
    ).toBeVisible();
    await expectAccessibleInBothThemes(chair);

    // Back on the Decisions page it is listed after those with no decision, and counted.
    await section.getByRole("link", { name: "All decisions" }).click();
    await expect(chair.getByRole("heading", { level: 1, name: "Decisions" })).toBeFocused();
    await expect(
      scientific.getByText("4 proposals await a decision. 3 have no decision yet."),
    ).toBeVisible();
    await expect(cards.locator("h3")).toHaveText([TALKS.one, TALKS.waits, TALKS.none, TALKS.two]);
    await expect(card(TALKS.two)).toContainText("Recorded: accept");
    await expect(card(TALKS.two)).toContainText("Not sent yet.");
    await expect(
      sending.getByText("Waiting to be sent: 2 accepted, 0 for the waiting list, 0 not accepted."),
    ).toBeVisible();

    // "Send the decisions" sends nothing: it asks, in its place, with the numbers and the
    // email for each outcome as it will be sent.
    await open.click();
    await expect(
      sending.getByRole("heading", { level: 3, name: "Send these decisions?" }),
    ).toBeFocused();
    await expect(open).toHaveCount(0);
    await expect(sending.locator(".send-numbers li")).toHaveText([
      "Proposals that will be told “accepted”: 2",
      "Proposals that will be told “on the waiting list”: 0",
      "Proposals that will be told “not accepted”: 0",
      // The two authors of the talk with two reviews, and the chair, whose own talk it counts.
      "People who will be emailed: 3",
      "Proposals with no decision yet, which will be told nothing: 3",
    ]);
    await expect(
      sending.getByText(
        "These numbers count every decision recorded at the conference, also for proposals you are not shown because they are your own or you have a conflict with them.",
      ),
    ).toBeVisible();
    await expect(
      sending.getByText(
        "A sent “accepted” or “not accepted” is final: it cannot be changed here afterwards. A proposal on the waiting list can be given a new decision later.",
      ),
    ).toBeVisible();
    await expect(
      sending.getByText(
        "These are the emails, with a made-up title and made-up comments. Each person gets theirs in their own language; this is the English text.",
      ),
    ).toBeVisible();
    const previews = sending.locator("figure.email-preview");
    await expect(previews.locator("figcaption")).toHaveText([
      "The email for “accepted”",
      "The email for “on the waiting list”",
      "The email for “not accepted”",
    ]);
    const settings = (await stored(chair, ROOM)).config;
    const conference = settings.title.en ?? "";
    // A preview's made-up proposal has the conference's first format, as on the settings screen.
    const format = settings.submissionTypes[0]?.name.en ?? "";
    await expect(previews.locator(".email-subject")).toHaveText([
      `${conference}: your proposal has been accepted`,
      `${conference}: your proposal is on the waiting list`,
      `${conference}: your proposal was not accepted`,
    ]);
    await expect(previews.nth(0).locator(".email-body")).toHaveText(
      [
        `The chairs of ${conference} have accepted your proposal "A made-up title" (${format}).`,
        // Every line of a reviewer's comment is quoted, and the line above them says so.
        "The lines that begin with > are comments from the reviewers, in the words they wrote:",
        "Reviewer 1:\n> A made-up comment: the argument is clear, and the examples carry it.",
        "Reviewer 2:\n> Another made-up comment, in two paragraphs.\n>\n> The second one asks for a word about the method.",
        "You can also read this on the proposal's page:",
        `${origin}/en/s/…`,
      ].join("\n\n"),
      { useInnerText: true },
    );
    const yes = sending.getByRole("button", { name: "Yes, send them" });
    const no = sending.getByRole("button", { name: "No, go back" });
    await expectTouchTarget(yes);
    await expectTouchTarget(no);
    await expectAccessibleInBothThemes(chair);
    await atBothWidths(() => expectNoHorizontalScroll(chair));
    // "No, go back": nothing was sent, and the button has the focus again.
    await no.click();
    await expect(open).toBeFocused();
    expect((await waitingAt()).accepted).toBe(2);
    expect(await mailOf("decision_accepted", AUTHORS.first)).toBeNull();

    // Taken back on the proposal's page: it is as if none had been recorded.
    await chair.goto(`/en/s/${id}#decision`);
    await expect(section.getByRole("heading", { level: 2, name: "Decision" })).toBeFocused();
    await takeBack.click();
    await expect(said).toHaveText("The decision was taken back. Nobody was told.");
    await expect(said).toBeFocused();
    await expect(section.getByText("No decision is recorded for this proposal.")).toBeVisible();
    await expect(takeBack).toHaveCount(0);
    await expect(choices.getByRole("radio", { checked: true })).toHaveCount(0);
    // All of it is as it was found.
    expect(await decisionsOf()).toEqual(before);
    expect(await waitingAt()).toEqual(waitingBefore);

    // The three emails are among those a chair can reword, each with when it is sent, what it
    // may name, and the email as it would be sent. Nothing is saved here.
    await chair.goto(`/en/c/${ROOM}/settings`);
    await expect(
      chair.getByRole("heading", { level: 1, name: "Conference settings" }),
    ).toBeVisible();
    for (const [name, when] of [
      [
        "Decision: accepted, to the authors",
        "Sent to the owner and to every confirmed co-author of a proposal when the chairs send the decisions and the proposal is accepted. Nobody can turn this email off. In its standard text it carries the reviewers' comments for the authors. It never carries a reviewer's name, a score, a recommendation or a note for the chairs.",
      ],
      [
        "Decision: on the waiting list, to the authors",
        "Sent to the owner and to every confirmed co-author of a proposal when the chairs send the decisions and the proposal is put on the waiting list. Nobody can turn this email off. When a new decision is sent for that proposal later, they get the email for that outcome.",
      ],
      [
        "Decision: not accepted, to the authors",
        "Sent to the owner and to every confirmed co-author of a proposal when the chairs send the decisions and the proposal is not accepted. Nobody can turn this email off. In its standard text it carries the reviewers' comments for the authors. It never carries a reviewer's name, a score, a recommendation or a note for the chairs.",
      ],
    ] as const) {
      const email = await openPool(chair, name);
      await expect(email.locator("p.meta").first()).toHaveText(when);
      await expect(email.locator(".placeholders dt")).toHaveText([
        "{title}",
        "{format}",
        "{conference}",
        "{comments}",
        "{link}",
      ]);
    }
    const accepted = await openPool(chair, "Decision: accepted, to the authors");
    await expect(accepted.locator(".placeholders dd")).toHaveText([
      "the proposal's title",
      "the proposal's format",
      "the conference's title",
      "the reviewers' comments for the authors, each under “Reviewer 1”, “Reviewer 2” and so on, with “>” before every line to mark it as their words, and without names or scores; where there are none, one sentence that says so. You can leave it out: the proposal's page shows them too.It cannot go in the subject.",
      "the link to the proposalThe text must contain it, and it cannot go in the subject.",
    ]);
    const english = accepted.getByRole("group", { name: "English" });
    await expect(english.getByLabel("Subject (English)")).toHaveValue(
      "{conference}: your proposal has been accepted",
    );
    await expect(english.locator(".email-body")).toContainText(
      "Reviewer 1:\n> A made-up comment: the argument is clear, and the examples carry it.\n\nReviewer 2:\n> ",
    );
    await expect(english.getByText("This is the standard text.")).toBeVisible();
    // A text without the link, and a subject with the comments, are refused where they are typed.
    const subject = english.getByLabel("Subject (English)");
    const body = english.getByLabel("Text (English)");
    const standard = { subject: await subject.inputValue(), body: await body.inputValue() };
    await body.fill("Yes: {title}.\n\n{comments}");
    await subject.fill("{conference}: {comments}");
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(english.locator(".field-error")).toContainText([
      "The subject cannot contain {comments}. Only the text can.",
      "The text must contain {link}.",
    ]);
    // Without the comments it is taken: the preview shows the email as it would then be sent.
    await subject.fill(standard.subject);
    await body.fill("Yes: {title}.\n\n{link}");
    await expect(english.locator(".email-body")).toHaveText(
      `Yes: A made-up title.\n\n${origin}/en/s/…`,
      { useInnerText: true },
    );
    await body.fill(standard.body);
    await expect(english.getByText("This is the standard text.")).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await expectNoHorizontalScroll(chair);
    await chair.getByRole("button", { name: "Review changes" }).click();
    await expect(chair.getByRole("status")).toHaveText("Nothing has been changed.");
    await expect.poll(() => unsavedKeys(chair)).toEqual([]);

    // In Spanish and in Portuguese: the page, the section of a proposal, and the emails' names.
    for (const [lang, title, sendTitle, decision, names] of [
      [
        "es",
        "Decisiones",
        "Enviar las decisiones",
        "Decisión",
        [
          "Decisión: aceptada, para las personas autoras",
          "Decisión: en lista de espera, para las personas autoras",
          "Decisión: no aceptada, para las personas autoras",
        ],
      ],
      [
        "pt",
        "Decisões",
        "Enviar as decisões",
        "Decisão",
        [
          "Decisão: aceite, para as pessoas autoras",
          "Decisão: em lista de espera, para as pessoas autoras",
          "Decisão: não aceite, para as pessoas autoras",
        ],
      ],
    ] as const) {
      await chair.goto(`/${lang}/c/${ROOM}/decisions`);
      await expect(chair.getByRole("heading", { level: 1, name: title })).toBeVisible();
      const part = chair.getByRole("region", { name: sendTitle });
      await part.getByRole("button", { name: sendTitle }).click();
      await expect(part.locator("figure.email-preview")).toHaveCount(3);
      await expect(part.locator(".email-body").first()).toContainText(
        lang === "es" ? "Revisión 1:" : "Revisão 1:",
      );
      await atBothWidths(() => expectNoHorizontalScroll(chair));
      await chair.goto(`/${lang}/s/${id}#decision`);
      await expect(chair.getByRole("region", { name: decision }).getByRole("radio")).toHaveCount(3);
      await atBothWidths(() => expectNoHorizontalScroll(chair));
      await chair.goto(`/${lang}/c/${ROOM}/settings`);
      for (const name of names) {
        await expect(chair.locator("summary", { hasText: name })).toHaveCount(1);
      }
    }
    expect(await decisionsOf()).toEqual(before);
  });

  test("a chair sends the decisions after a confirmation; the authors get them with the reviewers' comments, and a waitlisted proposal is accepted afterwards", async () => {
    test.slow();
    const origin = new URL(chair.url()).origin;
    const post = (path: string, method: "PUT" | "POST", data: unknown) =>
      chair.request.fetch(path, { method, headers: { origin }, data });
    const ids = {
      two: await talkId(TALKS.two),
      one: await talkId(TALKS.one),
      waits: await talkId(TALKS.waits),
      none: await talkId(TALKS.none),
    };
    const conference = (await stored(chair, ROOM)).config.title.en ?? "";
    const format = (await stored(chair, ROOM)).config.submissionTypes[0]?.name.en ?? "";

    // Two decisions, each recorded on its proposal's page.
    await recordOnPage(ids.two, "Accept", "Recorded: accept. Nobody was told.");
    await recordOnPage(ids.one, "Reject", "Recorded: reject. Nobody was told.");

    await chair.goto(`/en/c/${ROOM}/decisions`);
    const sending = chair.getByRole("region", { name: "Send the decisions" });
    // (The second "accepted" is the chair's own talk, which a co-chair decided: counted here,
    // and never listed or named.)
    await expect(
      sending.getByText("Waiting to be sent: 2 accepted, 0 for the waiting list, 1 not accepted."),
    ).toBeVisible();

    // Behind the page, as another chair would: a third decision is recorded, and the email for
    // "not accepted" is reworded. (No other test reads this conference's emails.) The fourth
    // talk gets no decision.
    const REWORDED =
      "[Reworded by a browser test] {title} ({format}) was not accepted.\n\n{comments}\n\n{link}";
    const settings = await stored(chair, ROOM);
    const worded = await chair.request.put(`/api/conferences/${ROOM}/config`, {
      headers: { origin, "if-match": `"${settings.token}"` },
      data: {
        ...settings.config,
        messages: { ...settings.config.messages, decision_rejected: { body: { en: REWORDED } } },
      },
    });
    expect(worded.status()).toBe(200);
    const third = `/api/conferences/${ROOM}/decisions/submissions/${ids.waits}`;
    expect((await post(third, "PUT", { outcome: "waitlisted" })).status()).toBe(204);

    // The button reads the page again: the confirmation says what waits now, and shows the
    // email as it is worded now, not what the page read when it was opened.
    const open = sending.getByRole("button", { name: "Send the decisions" });
    await open.click();
    await expect(
      sending.getByRole("heading", { level: 3, name: "Send these decisions?" }),
    ).toBeFocused();
    const numbers = sending.locator(".send-numbers li");
    await expect(numbers).toHaveText([
      "Proposals that will be told “accepted”: 2",
      "Proposals that will be told “on the waiting list”: 1",
      "Proposals that will be told “not accepted”: 1",
      "People who will be emailed: 3",
      "Proposals with no decision yet, which will be told nothing: 1",
    ]);
    // The email that was reworded meanwhile is previewed as it will be sent.
    await expect(sending.locator("figure.email-preview .email-body").nth(2)).toContainText(
      `[Reworded by a browser test] A made-up title (${format}) was not accepted.\n\nThe lines that begin with > are comments from the reviewers, in the words they wrote:\n\nReviewer 1:\n> A made-up comment`,
    );

    // Another chair changes a decision meanwhile (here, this chair's own session, behind the
    // page): what would be sent is no longer what the confirmation shows. Nothing is sent, and
    // the confirmation shows what waits now, to be read again.
    const elsewhere = `/api/conferences/${ROOM}/decisions/submissions/${ids.one}`;
    expect((await post(elsewhere, "PUT", { outcome: "accepted" })).status()).toBe(204);
    const yes = sending.getByRole("button", { name: "Yes, send them" });
    await yes.click();
    const note = sending.locator("form.confirm").getByRole("status");
    await expect(note).toHaveText(
      "Nothing was sent: what is waiting is no longer what this confirmation showed. It now shows what is waiting. Read it again, then send.",
    );
    await expect(numbers.nth(0)).toHaveText("Proposals that will be told “accepted”: 3");
    await expect(numbers.nth(2)).toHaveText("Proposals that will be told “not accepted”: 0");
    for (const kind of ["decision_accepted", "decision_waitlisted", "decision_rejected"]) {
      expect(await mailOf(kind, AUTHORS.first), kind).toBeNull();
    }
    await expectAccessibleInBothThemes(chair);
    // Put back, and confirmed again as it is now: once more the page had the older numbers.
    expect((await post(elsewhere, "PUT", { outcome: "rejected" })).status()).toBe(204);
    await yes.click();
    await expect(numbers.nth(0)).toHaveText("Proposals that will be told “accepted”: 2");
    await expect(numbers.nth(2)).toHaveText("Proposals that will be told “not accepted”: 1");

    // Confirmed with the numbers as they are: sent. The page says what was sent, there.
    await yes.click();
    const said = sending.locator("> .status-line");
    await expect(said).toHaveText(
      "The decisions were sent. Accepted: 2. On the waiting list: 1. Not accepted: 1. People emailed: 3.",
    );
    await expect(said).toBeFocused();
    await expect(sending.getByText("No decision is waiting to be sent.")).toBeVisible();
    await expect(sending.getByRole("button", { name: "Send the decisions" })).toHaveCount(0);
    // What still awaits a decision: the talk nobody reviewed, and the one on the waiting list.
    const scientific = chair.getByRole("region", { name: "Scientific committee" });
    await expect(
      scientific.getByText("2 proposals await a decision. 1 has no decision yet."),
    ).toBeVisible();
    const cards = scientific.locator(".cards > li");
    await expect(cards.locator("h3")).toHaveText([TALKS.none, TALKS.waits]);
    await expect(cards.nth(1)).toContainText("On the waiting list");
    await expect(cards.nth(1)).toContainText("The authors were told.");
    await expectAccessibleInBothThemes(chair);
    await atBothWidths(() => expectNoHorizontalScroll(chair));

    // The emails, read from the test outbox. The first author owns the accepted talk and the
    // one that was not accepted; the second is the co-author of the first and owns the one on
    // the waiting list.
    const acceptedMail = await mailOf("decision_accepted", AUTHORS.first);
    expect(acceptedMail?.subject).toBe(`${conference}: your proposal has been accepted`);
    const text = acceptedMail?.text ?? "";
    expect(
      text.startsWith(
        `The chairs of ${conference} have accepted your proposal "${TALKS.two}" (Individual talk).\n\nThe lines that begin with > are comments from the reviewers, in the words they wrote:\n\nReviewer 1:\n> Made-up comments for the authors, number `,
      ),
    ).toBe(true);
    // Both reviewers' comments, each under a number, every line quoted, with their line breaks.
    for (const said of ["number one.", "number two."]) {
      expect(text).toContain(
        `> Made-up comments for the authors, ${said}\n>\n> A second paragraph of them, to show that line breaks are kept.`,
      );
    }
    expect(text).toContain("\n\nReviewer 2:\n> Made-up comments for the authors, number ");
    expect(
      text.endsWith(
        `\n\nYou can also read this on the proposal's page:\n\n${origin}/en/s/${ids.two}`,
      ),
    ).toBe(true);
    // Never who reviewed, what they scored or recommended, or what they told the chairs.
    for (const hidden of [
      "Fictional First Reviewer",
      "Fictional Second Reviewer",
      "decisions-room-reviewer",
      "note for the chairs",
      "Recommendation",
      "unsure",
      "Clarity",
      "of 5",
    ]) {
      expect(text, hidden).not.toContain(hidden);
    }
    // The co-author who confirmed gets the same email.
    expect((await mailOf("decision_accepted", AUTHORS.second))?.text).toBe(text);
    // Not accepted, in the chairs' own words, with that talk's one review.
    const rejectedMail = await mailOf("decision_rejected", AUTHORS.first);
    expect(rejectedMail?.subject).toBe(`${conference}: your proposal was not accepted`);
    expect(rejectedMail?.text).toBe(
      [
        `[Reworded by a browser test] ${TALKS.one} (Individual talk) was not accepted.`,
        "The lines that begin with > are comments from the reviewers, in the words they wrote:",
        "Reviewer 1:\n> Made-up comments for the authors, number three.\n>\n> A second paragraph of them, to show that line breaks are kept.",
        `${origin}/en/s/${ids.one}`,
      ].join("\n\n"),
    );
    const waitlistedMail = await mailOf("decision_waitlisted", AUTHORS.second);
    expect(waitlistedMail?.subject).toBe(`${conference}: your proposal is on the waiting list`);
    expect(waitlistedMail?.text).toContain(
      `have put your proposal "${TALKS.waits}" (Individual talk) on the waiting list. It is not accepted so far, and it may still be: you will get another email when they decide.`,
    );
    expect(waitlistedMail?.text).toContain("number four.");
    // No reviewer is told anything, and the author of the undecided talk only of the others.
    for (const kind of ["decision_accepted", "decision_waitlisted", "decision_rejected"]) {
      for (const reviewer of ["decisions-room-reviewer-1", "decisions-room-reviewer-2"]) {
        expect(await mailOf(kind, `${reviewer}@example.org`), `${kind} ${reviewer}`).toBeNull();
      }
    }
    expect(await mailOf("decision_rejected", AUTHORS.second)).toBeNull();

    // What an author reads from then on. The chair is the author of their own talk, whose
    // decision a co-chair recorded and this send sent: on its page they are its owner, and
    // read the decision and the comments, and nothing of who reviewed.
    const ownMail = await mailOf("decision_accepted", "chair@example.org");
    // (It comes in the first language of the chair's profile, whichever that is.)
    const own = /\/(?:en|es|pt)\/s\/([0-9a-f-]{36})$/.exec(ownMail?.text ?? "")?.[1] ?? "";
    expect(ownMail?.text).toContain(TALKS.own);
    expect(ownMail?.text).toContain("Made-up comments for the authors, number five.");
    await chair.goto(`/en/s/${own}`);
    await expect(chair.getByRole("heading", { level: 1, name: TALKS.own })).toBeVisible();
    await expect(chair.locator("article .badge").first()).toHaveText("Accepted");
    await expect(
      chair.getByText("A decision on this proposal was sent: it can no longer be edited."),
    ).toBeVisible();
    const decided = chair.getByRole("region", { name: "Decision" });
    await expect(decided.getByText("This proposal has been accepted.")).toBeVisible();
    await expect(decided.getByText(/^The chairs sent this decision on .+\.$/)).toBeVisible();
    await expect(
      decided.getByRole("heading", { level: 3, name: "Comments from the reviewers" }),
    ).toBeVisible();
    await expect(
      decided.getByText(
        "The reviewers wrote these comments for the authors. Reviewers are not named.",
      ),
    ).toBeVisible();
    await expect(decided.getByRole("heading", { level: 4 })).toHaveText(["Reviewer 1"]);
    await expect(decided.locator(".review-text")).toHaveText(
      "Made-up comments for the authors, number five.\n\nA second paragraph of them, to show that line breaks are kept.",
      { useInnerText: true },
    );
    // No reviewer, no score, no note, and nothing a chair has: no reviewers, nothing to record.
    const page = chair.locator("main");
    for (const hidden of ["Fictional First Reviewer", "note for the chairs", "Recommendation"]) {
      await expect(page).not.toContainText(hidden);
    }
    await expect(chair.getByRole("region", { name: "Reviewers" })).toHaveCount(0);
    await expect(chair.getByRole("radio", { name: "Accept" })).toHaveCount(0);
    // An accepted proposal is withdrawn by writing to the conference.
    await expect(
      chair.getByText(/^This proposal can no longer be withdrawn here\. To withdraw it, write to /),
    ).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    await atBothWidths(() => expectNoHorizontalScroll(chair));
    // "My submissions" says it too.
    await chair.goto("/en/my");
    await expect(
      chair.locator(".card").filter({ hasText: TALKS.own }).locator(".badge"),
    ).toHaveText("Accepted");

    // For the chairs, a sent accept is final: the page says what the authors were told, and
    // offers nothing more to record. The proposal takes no new reviewer either.
    await chair.goto(`/en/s/${ids.two}#decision`);
    const section = chair.getByRole("region", { name: "Decision" });
    await expect(
      section.getByText(
        /^The authors were told on .+: “Accepted”\. That is final here: no other decision can be recorded for this proposal\.$/,
      ),
    ).toBeVisible();
    await expect(section.getByRole("radio")).toHaveCount(0);
    await expect(section.getByRole("button")).toHaveCount(0);
    // Nothing is said there of what no longer applies.
    await expect(section.getByText("Recording a decision here tells nobody.")).toHaveCount(0);
    await expect(section.getByText("No decision is recorded for this proposal.")).toHaveCount(0);
    await expect(
      chair
        .getByRole("region", { name: "Reviewers" })
        .getByText(
          "This proposal takes no new reviewers: it was withdrawn, or its decision was sent to the authors. You can still remove a reviewer it has.",
        ),
    ).toBeVisible();
    await expectAccessibleInBothThemes(chair);
    // The export says what is decided, whether it was sent, and how many reviews were sent.
    const csv = await (
      await chair.request.get(
        `/api/conferences/${ROOM}/submissions.csv?status=submitted,accepted,waitlisted,rejected`,
      )
    ).text();
    expect(csv.split("\r\n")[0]).toContain('"status","decision","decision_sent","reviews_sent"');
    expect(csv).toContain(`"${ids.two}","accepted","accepted","yes","2"`);
    expect(csv).toContain(`"${ids.one}","rejected","rejected","yes","1"`);
    expect(csv).toContain(`"${ids.waits}","waitlisted","waitlisted","yes","1"`);
    expect(csv).toContain(`"${ids.none}","submitted","","","0"`);

    // A proposal on the waiting list is given the decision that ends it, by the same two
    // steps: recorded on its page, where only an accept or a reject is offered, and then sent.
    await chair.goto(`/en/s/${ids.waits}#decision`);
    await expect(
      section.getByText(
        /^The authors were told on .+: “Waitlisted”\. You can record the decision that ends the waiting list, accept or reject\. It is sent like the first one\.$/,
      ),
    ).toBeVisible();
    await expect(
      section.getByRole("group", { name: "Decision for this proposal" }).locator("label"),
    ).toHaveText(["Accept", "Reject"]);
    // One was sent: the page does not say that none is recorded.
    await expect(section.getByText("No decision is recorded for this proposal.")).toHaveCount(0);
    await expectAccessibleInBothThemes(chair);
    await recordOnPage(ids.waits, "Accept", "Recorded: accept. Nobody was told.");
    // Until it is sent, its author was told "waiting list" and nothing else.
    expect((await mailOf("decision_accepted", AUTHORS.second))?.text).toBe(text);
    await chair.goto(`/en/c/${ROOM}/decisions`);
    await expect(cards.filter({ hasText: TALKS.waits })).toContainText("On the waiting list");
    await expect(cards.filter({ hasText: TALKS.waits })).toContainText("Recorded: accept");
    await open.click();
    await expect(numbers).toHaveText([
      "Proposals that will be told “accepted”: 1",
      "Proposals that will be told “on the waiting list”: 0",
      "Proposals that will be told “not accepted”: 0",
      "People who will be emailed: 1",
      "Proposals with no decision yet, which will be told nothing: 1",
    ]);
    await yes.click();
    await expect(said).toHaveText(
      "The decisions were sent. Accepted: 1. On the waiting list: 0. Not accepted: 0. People emailed: 1.",
    );
    await expect(said).toBeFocused();
    const later = await mailOf("decision_accepted", AUTHORS.second);
    expect(later?.text).toContain(
      `have accepted your proposal "${TALKS.waits}" (Individual talk).`,
    );
    expect(later?.text).toContain("number four.");
    // One talk is left to decide: the others are listed where their status says.
    const left = await decisionsOf();
    expect(left.pools[0]?.items.map((x) => [x.title, x.waitlisted, x.recorded])).toEqual([
      [TALKS.none, false, null],
    ]);
    const acceptedNow = (await (
      await chair.request.get(`/api/conferences/${ROOM}/submissions?status=accepted`)
    ).json()) as { items: { id: string }[] };
    // (The chair's own talk is in that list as its author is given it, and it is accepted too.)
    expect(acceptedNow.items.map((x) => x.id).sort()).toEqual([ids.two, ids.waits, own].sort());
  });
});
