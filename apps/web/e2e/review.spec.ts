import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/*
 * What a reviewer sees of a proposal assigned to them, on a phone. The seeded sandbox gives
 * reviewer-30 the artistic pool, whose formats are reviewed both ways: exhibition works with
 * the authors' names shown, performances anonymized.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const REVIEWER = "reviewer-30@example.org";

type Assigned = {
  view: string;
  blindMode?: "double" | "single" | "open";
  id: string;
  title: string;
  abstract: string;
};

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

  // Anonymized: the proposal's text, a line saying why nobody is named, and no list of people.
  await page.goto(`/en/s/${anonymized.id}`);
  await expect(page.getByRole("heading", { level: 1, name: anonymized.title })).toBeVisible();
  await expect(
    page.getByText("You are reading this proposal as one of its reviewers."),
  ).toBeVisible();
  await expect(page.getByText("the authors' names are not shown")).toBeVisible();
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

  // The page rendered every time: it never fell back to "Something went wrong".
  expect(failures).toEqual([]);
});
