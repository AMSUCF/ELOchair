import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/*
 * What a reviewer sees of a proposal assigned to them, on a phone. The seeded sandbox gives
 * reviewer-30 the artistic pool, whose formats are reviewed both ways: exhibition works with
 * the authors' names shown, performances anonymized. The chairs' guidelines for that pool's
 * reviewers are seeded too, and stand above every one of its proposals. (A reviewer sees no
 * proposal of another pool: that a pool without guidelines shows none is checked where a
 * reviewer of the other pool is signed in, in smoke.spec.ts.)
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const REVIEWER = "reviewer-30@example.org";

type Assigned = {
  view: string;
  blindMode?: "double" | "single" | "open";
  id: string;
  typeKey: string;
  title: string;
  abstract: string;
};

/** What the page reads of the conference to find a proposal's guidelines. */
type Conference = {
  config: {
    reviewPools: { key: string; guidelines?: Record<string, string> }[];
    submissionTypes: { key: string; reviewPool: string }[];
  };
};

/**
 * The guidelines above a proposal are the text the conference holds, whole, laid out with its
 * line breaks.
 */
async function expectGuidelines(page: Page, heading: string, text: string | undefined) {
  // They come first, before the proposal's own text.
  await expect(page.locator("main h2").first()).toHaveText(heading);
  const shown = page.getByRole("region", { name: heading }).locator("p");
  expect(await shown.textContent()).toBe(text);
  await expect(shown).toHaveCSS("white-space", "pre-wrap");
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
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

test("a reviewer reads the proposals assigned to them: the text, and the authors only where the review shows them", async ({
  page,
  request,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await signIn(page, request, REVIEWER);

  // Their assignments, as the server gives them (the page's own session).
  const listed = await page.request.get("/api/conferences/sandbox/submissions?limit=100");
  const assigned = ((await listed.json()) as { items: Assigned[] }).items.filter(
    (x) => x.view === "reviewer",
  );
  const anonymized = assigned.find((x) => x.blindMode === "double");
  const named = assigned.find((x) => x.blindMode === "single");
  expect(anonymized, "a proposal in anonymized review").toBeTruthy();
  expect(named, "a proposal reviewed with the authors' names shown").toBeTruthy();
  if (!anonymized || !named) return;

  // The guidelines the chairs wrote for the pool that reviews both formats, as the conference
  // holds them: in three languages, in paragraphs.
  const { config } = (await (
    await page.request.get("/api/conferences/sandbox")
  ).json()) as Conference;
  const guidelinesFor = (typeKey: string) => {
    const pool = config.submissionTypes.find((x) => x.key === typeKey)?.reviewPool;
    return config.reviewPools.find((x) => x.key === pool)?.guidelines;
  };
  const guidelines = guidelinesFor(anonymized.typeKey);
  expect(guidelines?.en, "guidelines for the reviewer's pool").toContain("\n\n");
  expect(guidelines?.es).toBeTruthy();
  expect(guidelinesFor(named.typeKey)).toEqual(guidelines);
  if (!guidelines) return;

  // Anonymized: the proposal's text, a line saying why nobody is named, and no list of people.
  await page.goto(`/en/s/${anonymized.id}`);
  await expect(page.getByRole("heading", { level: 1, name: anonymized.title })).toBeVisible();
  await expect(
    page.getByText("You are reading this proposal as one of its reviewers."),
  ).toBeVisible();
  await expect(page.getByText("the authors' names are not shown")).toBeVisible();
  await expectGuidelines(page, "Guidelines for reviewers", guidelines.en);
  await expect(page.getByText(anonymized.abstract.slice(0, 60))).toBeVisible();
  await expect(page.getByRole("heading", { name: "People" })).toHaveCount(0);
  // Nothing to edit, nothing to press, and nobody's address.
  await expect(page.locator("main").getByRole("textbox")).toHaveCount(0);
  await expect(page.locator("main").getByRole("button")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("@example.org");
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page);
  await page.emulateMedia({ colorScheme: "light" });

  // Names shown: the people are listed, still without an address, and the line about hidden
  // names is gone.
  await page.goto(`/en/s/${named.id}`);
  await expect(page.getByRole("heading", { level: 1, name: named.title })).toBeVisible();
  await expect(
    page.getByText("You are reading this proposal as one of its reviewers."),
  ).toBeVisible();
  await expect(page.getByText("the authors' names are not shown")).toHaveCount(0);
  // The same guidelines: they are the pool's, however the format is reviewed.
  await expectGuidelines(page, "Guidelines for reviewers", guidelines.en);
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(page.locator("main li").first()).toContainText("Lead author");
  await expect(page.locator("main")).not.toContainText("@example.org");
  await expect(page.locator("main").getByRole("textbox")).toHaveCount(0);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  // In Spanish the two sentences are Spanish.
  await page.goto(`/es/s/${anonymized.id}`);
  await expect(
    page.getByText("Estás leyendo esta propuesta como una de las personas que la revisan."),
  ).toBeVisible();
  await expect(page.getByText("La revisión es anónima")).toBeVisible();
  // And the guidelines are the ones written in Spanish.
  await expectGuidelines(page, "Pautas para quienes revisan", guidelines.es);

  // The page rendered every time: it never fell back to "Something went wrong".
  expect(failures).toEqual([]);
});
