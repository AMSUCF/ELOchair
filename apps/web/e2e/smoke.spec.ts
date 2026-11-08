import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

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

test("the 2026 call for proposals reads well on a phone", async ({ page }) => {
  await page.goto("/en/c/elo2026");
  await expect(
    page.getByRole("heading", { level: 1, name: "ELO 2026: (un)supervised" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Individual talk" })).toBeVisible();
  await expect(page.getByText("250–300 words").first()).toBeVisible();
  await expect(
    page.getByText("Anonymized review: reviewers do not see who you are.").first(),
  ).toBeVisible();
  // Deadlines in conference time and, for this Lisbon visitor, in their own time.
  await expect(page.getByText("Conference time (America/New_York)").first()).toBeVisible();
  await expect(page.getByText("Your time (Europe/Lisbon)").first()).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);
});

test("the interface switches language", async ({ page }) => {
  await page.goto("/en/");
  await page.getByLabel("Language").selectOption("es");
  await expect(page).toHaveURL(/\/es\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Congresos" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expectAccessible(page);
});

test("sign in with a magic link, then sign out", async ({ page, request }) => {
  const email = "chair@example.org";
  await page.goto("/en/sign-in");
  await expectAccessible(page);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();

  const mail = await (await request.get(`/api/_test/outbox/latest?to=${email}`)).json();
  const link = /https?:\/\/\S+#token=\S+/.exec(mail.text)?.[0];
  expect(link).toBeTruthy();

  await page.goto(link as string);
  await expect(page).toHaveURL(/\/en\/me$/); // token removed from the address bar
  await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("sandbox: Chair")).toBeVisible();
  await expectAccessible(page);

  // The same link cannot be used twice.
  await page.goto(link as string);
  await expect(page.getByText("This link has expired or has already been used.")).toBeVisible();

  await page.goto("/en/me");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/en/me");
  await expect(page.getByText("Please sign in to see your account.")).toBeVisible();
});
