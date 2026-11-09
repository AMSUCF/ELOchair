import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

/** House rule 8: anything people tap is at least 44px tall. */
async function expectTouchTarget(target: Locator) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function latestMail(request: APIRequestContext, email: string) {
  return (await (await request.get(`/api/_test/outbox/latest?to=${email}`)).json()) as {
    text: string;
  };
}

async function requestLink(page: Page, email: string) {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
}

test("the 2026 call for proposals reads well on a phone", async ({ page }) => {
  await page.goto("/en/c/elo2026");
  await expect(
    page.getByRole("heading", { level: 1, name: "ELO 2026: (un)supervised" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("ELO 2026: (un)supervised – ELOchair");
  await expect(page.getByRole("heading", { name: "Individual talk" })).toBeVisible();
  await expect(page.getByText("250–300 words").first()).toBeVisible();
  await expect(
    page.getByText("Anonymized review: reviewers do not see who you are.").first(),
  ).toBeVisible();
  // Deadlines in conference time and, for this Lisbon visitor, in their own time.
  await expect(page.getByText("Conference time (America/New_York)").first()).toBeVisible();
  await expect(page.getByText("Your time (Europe/Lisbon)").first()).toBeVisible();
  await expect(page.getByText(/Submissions are closed\./)).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);
});

test("navigating moves focus to the new page's heading once it has loaded", async ({ page }) => {
  await page.goto("/en/");
  await page.getByRole("link", { name: "ELO 2026: (un)supervised" }).click();
  const h1 = page.getByRole("heading", { level: 1, name: "ELO 2026: (un)supervised" });
  await expect(h1).toBeFocused();
});

test("the interface switches language with links", async ({ page }) => {
  await page.goto("/en/");
  await page.getByRole("link", { name: "Español" }).click();
  await expect(page).toHaveURL(/\/es\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Congresos" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("link", { name: "Español" })).toHaveAttribute("aria-current", "true");
  // English-only configuration text is marked as English inside the Spanish page.
  await expect(page.locator('a[href="/es/c/elo2026"] span[lang="en"]')).toHaveText(
    "ELO 2026: (un)supervised",
  );
  await expectAccessible(page);
});

test("sign in with a magic link after confirming, then sign out", async ({ page, request }) => {
  const email = "chair@example.org";
  await page.goto("/en/sign-in");
  await expectAccessible(page);
  await requestLink(page, email);

  const link = /https?:\/\/\S+#token=\S+/.exec((await latestMail(request, email)).text)?.[0];
  expect(link).toBeTruthy();

  // Opening the link alone signs nobody in: it says who, and waits for a tap.
  await page.goto(link as string);
  await expect(page.getByText(`This link signs you in as ${email}.`)).toBeVisible();
  await expect(page).toHaveURL(/\/en\/auth\/verify$/); // token removed from the address bar
  await expectAccessible(page);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/en\/me$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("sandbox: Chair")).toBeVisible();
  await expectAccessible(page);

  // The same link cannot be used twice.
  await page.goto(link as string);
  await expect(page.getByText("This link has expired or has already been used.")).toBeVisible();

  await page.goto("/en/me");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en\/$/);
  await page.goto("/en/me");
  await expect(page.getByText("Please sign in to see your account.")).toBeVisible();
});

test("sign in by typing the code (for the installed app)", async ({ page, request }) => {
  const email = "reviewer-1@example.org";
  await requestLink(page, email);
  const m = /\b(\d{4}) (\d{4})\b/.exec((await latestMail(request, email)).text);
  expect(m).toBeTruthy();
  await page.getByLabel("Code from the email").fill(`${m?.[1]} ${m?.[2]}`);
  await page.getByRole("button", { name: "Sign in with code" }).click();
  await expect(page).toHaveURL(/\/en\/me$/);
  await expect(page.getByText("sandbox: Reviewer")).toBeVisible();
});

test("a link for another account warns before switching", async ({ page, request }) => {
  await requestLink(page, "admin@example.org");
  const m = /\b(\d{4}) (\d{4})\b/.exec((await latestMail(request, "admin@example.org")).text);
  await page.getByLabel("Code from the email").fill(`${m?.[1]}${m?.[2]}`);
  await page.getByRole("button", { name: "Sign in with code" }).click();
  await expect(page).toHaveURL(/\/en\/me$/);

  await requestLink(page, "track-chair-1@example.org");
  const link = /https?:\/\/\S+#token=\S+/.exec(
    (await latestMail(request, "track-chair-1@example.org")).text,
  )?.[0];
  await page.goto(link as string);
  await expect(page.getByText("You are currently signed in as admin@example.org.")).toBeVisible();
});

test("retrying after a network error keeps the link working", async ({ page, request }) => {
  const email = "track-chair-2@example.org";
  await requestLink(page, email);
  const link = /https?:\/\/\S+#token=\S+/.exec((await latestMail(request, email)).text)?.[0];
  await page.goto(link as string);
  await page.route("**/api/auth/verify", (route) => route.abort());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("We could not reach the server.")).toBeVisible();
  await page.unroute("**/api/auth/verify");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).toHaveURL(/\/en\/me$/);
});

test("a code from an earlier email still works after reloading the sign-in page", async ({
  page,
  request,
}) => {
  const email = "track-chair-3@example.org";
  await requestLink(page, email);
  const m = /\b(\d{4}) (\d{4})\b/.exec((await latestMail(request, email)).text);
  await page.reload();
  await page.getByLabel("Email address").fill(email);
  // The disclosure is a full-size touch target, and keeps its open/closed marker.
  const haveCode = page.getByText("I already have a code");
  await expectTouchTarget(haveCode);
  expect(await haveCode.evaluate((el) => getComputedStyle(el).display)).toBe("list-item");
  await haveCode.click();
  await page.getByLabel("Code from the email").fill(`${m?.[1]}${m?.[2]}`);
  await page.getByRole("button", { name: "Sign in with code" }).click();
  await expect(page).toHaveURL(/\/en\/me$/);
});

test("a page that fails to render says so in the interface language, and the rest still works", async ({
  page,
}) => {
  // Data the page cannot render (as from a newer server) must not leave an empty screen.
  await page.route("**/api/conferences", (route) =>
    route.fulfill({ json: { conferences: [{ slug: "broken" }] } }),
  );
  await page.goto("/es/");
  await expect(page.getByRole("heading", { level: 1, name: "Algo salió mal" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(/No se pudo mostrar esta página/);
  await expectAccessible(page);
  await page.getByRole("navigation").getByRole("link", { name: "Tu cuenta" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tu cuenta" })).toBeVisible();
  // Back to the failing page by a link: its heading takes focus first, then the crash replaces
  // it. Focus must land on the error's heading, not on the page body.
  await page.getByRole("link", { name: "ELOchair", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Algo salió mal" })).toBeFocused();
});

test("an unknown conference says so, in the heading and the title", async ({ page }) => {
  await page.goto("/en/c/no-such-conference");
  await expect(
    page.getByRole("heading", { level: 1, name: "We could not find that conference." }),
  ).toBeVisible();
  await expect(page).toHaveTitle("We could not find that conference. – ELOchair");
});
