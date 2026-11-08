import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const CALL = "elo2027-open";
const words = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => ["electronic", "literature", "poem", "machine", "reader"][i % 5],
  ).join(" ");

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

async function latestMail(request: APIRequestContext, email: string) {
  const res = await request.get(`/api/_test/outbox/latest?to=${encodeURIComponent(email)}`);
  return (await res.json()) as { subject: string; text: string };
}

/** Sign in with the emailed code (the path the installed app uses). */
async function signIn(page: Page, request: APIRequestContext, email: string) {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const code = /\b(\d{4}) (\d{4})\b/.exec((await latestMail(request, email)).text);
  await page.getByLabel("Code from the email").fill(`${code?.[1]}${code?.[2]}`);
  await page.getByRole("button", { name: "Sign in with code" }).click();
  await expect(page).toHaveURL(/\/en\/me$/);
}

async function setName(page: Page, name: string) {
  await page.goto("/en/me");
  await page.getByLabel("Your name, as it should appear").fill(name);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
}

async function start(page: Page, format: string) {
  await page.goto(`/en/c/${CALL}`);
  await page.getByRole("link", { name: "Submit a proposal" }).click();
  await page.getByRole("radio", { name: new RegExp(format) }).check();
  await page.getByRole("radio", { name: "In person" }).check();
  await page.getByRole("button", { name: /^Start a / }).click();
  await expect(page).toHaveURL(/\/en\/s\/[0-9a-f-]+$/);
}

async function acceptAgreements(page: Page) {
  const boxes = page.getByRole("checkbox", { name: /^I accept:/ });
  await expect(boxes.first()).toBeVisible(); // the page loads its data after a reload
  for (const box of await boxes.all()) await box.check();
}

/** Answer an invitation from the link in the email, in a fresh browser (no account needed). */
async function answerByLink(
  browser: Browser,
  request: APIRequestContext,
  email: string,
  answer: "confirm" | "decline",
  name?: string,
) {
  const sent = /https?:\/\/\S+#token=\S+/.exec(
    (await latestMail(request, email)).text,
  )?.[0] as string;
  // The email may be in Spanish or Portuguese; open the same invitation in English for the test.
  const link = sent.replace(/\/(es|pt)\/invitation#/, "/en/invitation#");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(link);
  await expect(
    page.getByRole("heading", { level: 1, name: "Invitation to a proposal" }),
  ).toBeVisible();
  if (answer === "confirm") {
    await expectAccessible(page);
    if (name) await page.getByLabel("Your name").fill(name);
    await acceptAgreements(page);
    await page.getByRole("button", { name: "Confirm my participation" }).click();
    await expect(page.getByText("Thank you: you are confirmed.")).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText("You declined.")).toBeVisible();
  }
  await context.close();
}

test("submit a talk from a phone: word count, self-identification, co-author, agreements, receipt", async ({
  page,
  request,
  browser,
}) => {
  const owner = "e2e-owner@example.org";
  await signIn(page, request, owner);
  await setName(page, "Ana Testing Owner");
  await start(page, "Individual talk");
  await expectAccessible(page);

  await page.getByLabel("Title").fill("Poems that read their readers");
  await page.getByLabel("Abstract (anonymized)").fill(`${words(240)} as Ana Testing Owner argued`);
  await expect(page.locator("#abstract-count")).toHaveText("245 words: at least 250 needed");
  await expect(page.getByText("The abstract mentions an author's name.")).toBeVisible();
  await page.getByLabel("Abstract (anonymized)").fill(words(260));
  await expect(page.locator("#abstract-count")).toHaveText("260 words (between 250 and 300)");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

  await page.getByLabel("Email", { exact: true }).fill("e2e-coauthor@example.org");
  await page.getByLabel("Name (optional)").fill("Bruno Coauthor");
  await page.getByLabel("Language of the invitation email").selectOption("es");
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();
  await expect(page.getByText("Bruno Coauthor")).toBeVisible();
  const invitation = await latestMail(request, "e2e-coauthor@example.org");
  expect(invitation.subject).toContain("confirma tu participación");
  expect(invitation.text).not.toContain("Poems that read their readers");

  await answerByLink(browser, request, "e2e-coauthor@example.org", "confirm", "Bruno Coauthor");

  await page.reload();
  await acceptAgreements(page);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Submitted. A receipt is on its way")).toBeVisible();
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  expect((await latestMail(request, owner)).subject).toContain("proposal received");

  await page.goto("/en/my");
  await expect(page.getByRole("link", { name: "Poems that read their readers" })).toBeVisible();
  await expectAccessible(page);
});

test("a panel of three: one invitee declines and is replaced", async ({
  page,
  request,
  browser,
}) => {
  await signIn(page, request, "e2e-panel@example.org");
  await setName(page, "Pia Panel Owner");
  await start(page, "Panel or roundtable");
  await page.getByLabel("Title").fill("Panel on platforms");
  await page.getByLabel("Session abstract (anonymized)").fill(words(400));
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  for (const who of ["one", "two"]) {
    await page.getByLabel("Email", { exact: true }).fill(`e2e-panelist-${who}@example.org`);
    await page.getByLabel("Role", { exact: true }).selectOption("panelist");
    await page.getByRole("button", { name: "Send invitation", exact: true }).click();
    await expect(page.getByText("Invitation sent.")).toBeVisible();
  }
  await answerByLink(browser, request, "e2e-panelist-one@example.org", "decline");
  await answerByLink(browser, request, "e2e-panelist-two@example.org", "confirm", "Panelist Two");
  expect((await latestMail(request, "e2e-panel@example.org")).subject).toMatch(
    /declined|confirmed/,
  );

  await page.reload();
  await page.getByLabel("Email", { exact: true }).fill("e2e-panelist-three@example.org");
  await page.getByLabel("Role", { exact: true }).selectOption("panelist");
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();
  await answerByLink(
    browser,
    request,
    "e2e-panelist-three@example.org",
    "confirm",
    "Panelist Three",
  );

  await page.reload();
  await acceptAgreements(page);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Submitted. A receipt is on its way")).toBeVisible();
});

test("an exhibition work submitted by URL", async ({ page, request }) => {
  await signIn(page, request, "e2e-artist@example.org");
  await setName(page, "Ada Artist");
  await start(page, "Exhibition work");
  await page.getByLabel("Title").fill("A garden of forking links");
  await page.getByLabel("Artist statement").fill(words(360));
  await page
    .getByLabel("URL of the work or a demonstration in progress")
    .fill("https://example.net/garden");
  await page.getByLabel(/Platforms and tools used/).fill("Twine and hand-written JavaScript.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await acceptAgreements(page);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Submitted. A receipt is on its way")).toBeVisible();
});

test("a chair follows the call and downloads both CSV files", async ({ page, request }) => {
  await signIn(page, request, "chair@example.org");
  await page.goto(`/en/c/${CALL}`);
  await page.getByRole("link", { name: "Manage submissions" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Manage submissions" })).toBeVisible();
  await expect(page.getByText(/drafts in progress/)).toBeVisible();
  await expectAccessible(page);
  const csv = await page.request.get(`/api/conferences/${CALL}/submissions.csv?status=submitted`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-disposition"]).toContain(`${CALL}-submissions.csv`);
  const people = await page.request.get(`/api/conferences/${CALL}/contributors.csv`);
  expect(people.status()).toBe(200);
});
