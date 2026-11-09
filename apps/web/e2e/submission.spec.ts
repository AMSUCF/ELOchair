import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import {
  type APIRequestContext,
  type Browser,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

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

/** axe in the light theme and again with the phone set to dark mode. */
async function expectAccessibleInBothThemes(page: Page) {
  await expectAccessible(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/** House rule 8: anything people tap is at least 44px tall. */
async function expectTouchTarget(target: Locator) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

async function latestMail(request: APIRequestContext, email: string) {
  const res = await request.get(`/api/_test/outbox/latest?to=${encodeURIComponent(email)}`);
  return (await res.json()) as { subject: string; text: string };
}

/** A second phone (a co-author's), on the same server. */
async function newPhone(browser: Browser) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "en-US",
  });
  return context.newPage();
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
  // The details at the top follow the saved profile.
  await expect(page.locator(".details")).toContainText(name);
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
  opts: { name?: string; invitedName?: string; flaky?: boolean } = {},
) {
  const sent = /https?:\/\/\S+#token=\S+/.exec(
    (await latestMail(request, email)).text,
  )?.[0] as string;
  // The email may be in Spanish or Portuguese; open the same invitation in English for the test.
  const link = sent.replace(/\/(es|pt)\/invitation#/, "/en/invitation#");
  const page = await newPhone(browser);
  // A dropped connection is not a dead link: the page keeps the token and offers to try again.
  if (opts.flaky) await page.route("**/api/invitations/info", (route) => route.abort());
  await page.goto(link);
  await expect(
    page.getByRole("heading", { level: 1, name: "Invitation to a proposal" }),
  ).toBeVisible();
  if (opts.flaky) {
    await expect(page.getByText("We could not reach the server.")).toBeVisible();
    await expect(page).not.toHaveURL(/token=/);
    await page.unroute("**/api/invitations/info");
    await page.getByRole("button", { name: "Try again" }).click();
  }
  if (answer === "confirm") {
    const name = page.getByLabel(/^Your name/);
    // Never prefilled with what the owner typed; shown only as context.
    await expect(name).toHaveValue("");
    if (opts.invitedName) {
      await expect(
        page.getByText(`The proposal's owner wrote your name as “${opts.invitedName}”.`),
      ).toBeVisible();
    }
    await expectAccessible(page);
    if (opts.name) await name.fill(opts.name);
    await acceptAgreements(page);
    await page.getByRole("button", { name: "Confirm my participation" }).click();
    await expect(page.getByText("Thank you: you are confirmed.")).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText("You declined.")).toBeVisible();
  }
  await page.context().close();
}

test("submit a talk from a phone: word count, self-identification, co-author, agreements, receipt", async ({
  page,
  request,
  browser,
}) => {
  const owner = "e2e-owner@example.org";
  await signIn(page, request, owner);
  await setName(page, "Ana Testing Owner");
  await page.goto(`/en/c/${CALL}`);
  await expect(page.getByText(/^Submissions are open until/)).toBeVisible();
  await expectAccessibleInBothThemes(page);
  await start(page, "Individual talk");
  await expectAccessible(page);

  await page.getByLabel("Title").fill("Poems that read");
  await page.getByLabel("Abstract (anonymized)").fill(`${words(240)} as Ana Testing Owner argued`);
  await expect(page.locator("#abstract-count")).toHaveText("245 words: at least 250 needed");
  await expect(page.getByText("The abstract mentions an author's name.")).toBeVisible();
  // Saved, the server's check finds the name too; rewording clears the warning before saving.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(page.getByText("The abstract mentions an author's name.")).toBeVisible();
  await page.getByLabel("Abstract (anonymized)").fill(words(260));
  await expect(page.locator("#abstract-count")).toHaveText("260 words (between 250 and 300)");
  await expect(page.getByText("The abstract mentions an author's name.")).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  // A draft does not count yet: the note says what submitting would do.
  await expect(page.getByText(/^If you submit this, you will hold 1 of at most 2/)).toBeVisible();

  await page.getByLabel("Email", { exact: true }).fill("e2e-coauthor@example.org");
  await page.getByLabel("Name (optional)").fill("Bruno Coauthor");
  await page.getByLabel("Language of the invitation email").selectOption("es");
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();
  // Each person's controls say whose they are.
  await expect(page.getByRole("button", { name: "Remove: Bruno Coauthor" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Role: Bruno Coauthor" })).toBeVisible();
  const invitation = await latestMail(request, "e2e-coauthor@example.org");
  expect(invitation.subject).toContain("confirma tu participación");
  expect(invitation.text).not.toContain("Poems that read");

  // The owner keeps typing while the co-author confirms: the save is stale, the text survives.
  await page.getByLabel("Title").fill("Poems that read their readers");
  await answerByLink(browser, request, "e2e-coauthor@example.org", "confirm", {
    name: "Bruno Coauthor",
    invitedName: "Bruno Coauthor",
  });
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("This proposal was changed elsewhere")).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Poems that read their readers");
  await page.getByRole("button", { name: "Load the latest version and keep my changes" }).click();
  await expect(page.getByText("Loaded the latest version and kept your changes.")).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Poems that read their readers");
  await expect(
    page.locator(".people > li").filter({ hasText: "Bruno Coauthor" }).locator(".badge"),
  ).toHaveText("Confirmed");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

  await expectTouchTarget(page.getByRole("link", { name: "Read", exact: true }).first());
  await expectTouchTarget(page.getByRole("main").getByRole("link", { name: "My submissions" }));
  await acceptAgreements(page);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Submitted. A receipt is on its way")).toBeVisible();
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(page.getByText(/^You hold 1 of at most 2/)).toBeVisible();
  expect((await latestMail(request, owner)).subject).toContain("proposal received");
  // Withdraw and Remove (danger buttons) must stay readable on a phone in dark mode.
  await expect(page.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await expectAccessibleInBothThemes(page);

  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("Poems that read their readers");
  await page.goto("/en/my");
  const card = page.getByRole("link", { name: "Poems that read their readers" });
  await expectTouchTarget(card);
  await expectAccessible(page);
});

test("a panel of three: one invitee declines and is replaced", async ({
  page,
  request,
  browser,
}) => {
  const owner = "e2e-panel@example.org";
  await signIn(page, request, owner);
  await setName(page, "Pia Panel Owner");
  await start(page, "Panel or roundtable");
  await page.getByLabel("Title").fill("Panel on platforms");
  await page.getByLabel("Session abstract (anonymized)").fill(words(400));
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  const invites: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/contributors")) invites.push(r.url());
  });
  for (const who of ["one", "two"]) {
    await page.getByLabel("Email", { exact: true }).fill(`e2e-panelist-${who}@example.org`);
    await page.getByLabel("Role", { exact: true }).selectOption("panelist");
    const send = page.getByRole("button", { name: "Send invitation", exact: true });
    // A double tap sends one invitation, not a second (stale) request.
    if (who === "two") await send.dblclick();
    else await send.click();
    await expect(page.locator(".people > li")).toHaveCount(who === "one" ? 2 : 3);
    await expect(page.getByText("Invitation sent.")).toBeVisible();
  }
  expect(invites).toHaveLength(2);
  await expect(page.getByText("This proposal was changed elsewhere")).toHaveCount(0);

  await answerByLink(browser, request, "e2e-panelist-one@example.org", "decline");
  // The owner hears about the decline at once.
  expect((await latestMail(request, owner)).subject).toContain("declined your proposal");
  await answerByLink(browser, request, "e2e-panelist-two@example.org", "confirm", {
    name: "Panelist Two",
  });
  expect((await latestMail(request, owner)).subject).toContain("confirmed your proposal");

  await page.reload();
  await page.getByLabel("Email", { exact: true }).fill("e2e-panelist-three@example.org");
  await page.getByLabel("Role", { exact: true }).selectOption("panelist");
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();
  await answerByLink(browser, request, "e2e-panelist-three@example.org", "confirm", {
    name: "Panelist Three",
    flaky: true,
  });

  await page.reload();
  await acceptAgreements(page);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Submitted. A receipt is on its way")).toBeVisible();
});

test("an exhibition work submitted by URL, on a phone whose clock is wrong", async ({
  page,
  request,
}) => {
  // The server decides whether the call is open; a phone set years ahead still sees it open.
  await page.clock.setFixedTime(new Date("2099-01-01T00:00:00Z"));
  await signIn(page, request, "e2e-artist@example.org");
  await setName(page, "Ada Artist");
  await start(page, "Exhibition work");
  const editor = page.url();
  await page.getByLabel("Title").fill("A garden of forking links");
  await page.getByLabel("Artist statement").fill(words(360));
  await page
    .getByLabel("URL of the work or a demonstration in progress")
    .fill("https://example.net/garden");
  await page.getByLabel(/Platforms and tools used/).fill("Twine and hand-written JavaScript.");

  // Leaving with unsaved changes asks first; staying keeps the text.
  let asked = "";
  page.once("dialog", (dialog) => {
    asked = dialog.message();
    dialog.dismiss();
  });
  await page.getByRole("navigation").getByRole("link", { name: "My submissions" }).click();
  await expect.poll(() => asked).toContain("unsaved changes");
  expect(page.url()).toBe(editor);
  await expect(page.getByLabel("Title")).toHaveValue("A garden of forking links");

  // Submitting saves the unsaved changes first, then submits the saved version.
  await acceptAgreements(page);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Submitted. A receipt is on its way")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("A garden of forking links");
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
});

test("invitees answer in the app: asked for their own name, one confirms then leaves, one declines", async ({
  page,
  request,
  browser,
}) => {
  const owner = "e2e-inapp-owner@example.org";
  await signIn(page, request, owner);
  await setName(page, "Olga Inapp Owner");
  await start(page, "Individual talk");
  await page.getByLabel("Title").fill("Reading in the app");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  for (const [email, name] of [
    ["e2e-inapp-co@example.org", "Typed By Owner"],
    ["e2e-inapp-no@example.org", ""],
  ] as const) {
    await page.getByLabel("Email", { exact: true }).fill(email);
    if (name) await page.getByLabel("Name (optional)").fill(name);
    await page.getByRole("button", { name: "Send invitation", exact: true }).click();
    await expect(page.getByText("Invitation sent.")).toBeVisible();
  }

  const co = await newPhone(browser);
  await signIn(co, request, "e2e-inapp-co@example.org");
  await co.goto("/en/my");
  await co.getByRole("link", { name: "Reading in the app" }).click();
  await expect(co.getByText("You have been invited to take part in this proposal.")).toBeVisible();
  const name = co.getByLabel(/^Your name/);
  await expect(name).toHaveValue("");
  await expectAccessible(co);
  await acceptAgreements(co);
  await co.getByRole("button", { name: "Confirm my participation" }).click();
  await expect(co.locator("#inv-name-error")).toHaveText("Enter your name to confirm.");
  await expect(name).toBeFocused();
  await name.fill("Cora Coauthor");
  await co.getByRole("button", { name: "Confirm my participation" }).click();
  await expect(co.getByText("You are confirmed. The owner has been told.")).toBeVisible();

  co.once("dialog", (dialog) => dialog.accept());
  await co.getByRole("button", { name: "Leave this proposal" }).click();
  await expect(co.getByText("You left this proposal. The owner has been told.")).toBeVisible();
  await expect(co.getByRole("button", { name: "Leave this proposal" })).toHaveCount(0);
  await co.getByRole("main").getByRole("link", { name: "My submissions" }).click();
  await expect(co.getByRole("heading", { level: 1, name: "My submissions" })).toBeVisible();
  await expect(co.getByRole("link", { name: "Reading in the app" })).toHaveCount(0);
  await co.context().close();

  const no = await newPhone(browser);
  await signIn(no, request, "e2e-inapp-no@example.org");
  await no.goto("/en/my");
  await no.getByRole("link", { name: "Reading in the app" }).click();
  await no.getByRole("button", { name: "Decline" }).click();
  await expect(
    no.getByText("You declined. You will not be listed on this proposal."),
  ).toBeVisible();
  await expect(no.getByRole("heading", { level: 1, name: "Reading in the app" })).toBeVisible();
  await expectTouchTarget(no.getByRole("main").getByRole("link", { name: "My submissions" }));
  await no.context().close();
});

test("a chair finds the submissions, opens one and downloads both CSV files", async ({
  page,
  request,
}) => {
  await signIn(page, request, "chair@example.org");
  await page.goto(`/en/c/${CALL}`);
  await page.getByRole("link", { name: "Manage submissions" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Manage submissions" })).toBeVisible();
  await expect(page.getByText(/drafts in progress/)).toBeVisible();
  await expect(page.getByText(/^Showing \d+ of \d+/)).toBeVisible();
  await expectAccessible(page);

  // The proposals submitted by the tests above are listed, and open from the list.
  const titles = [
    "Poems that read their readers",
    "Panel on platforms",
    "A garden of forking links",
  ];
  for (const title of titles) await expect(page.getByRole("link", { name: title })).toBeVisible();
  await expectTouchTarget(page.getByRole("link", { name: "Panel on platforms" }));
  await page.getByRole("link", { name: "Panel on platforms" }).click();
  await expect(page).toHaveURL(/\/en\/s\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Panel on platforms" })).toBeVisible();
  // Chairs see the panelist who declined.
  await expect(page.getByText(/Panelist · Declined/)).toBeVisible();
  await expectAccessible(page);
  await page.goBack();

  const csv = async (link: string) => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: link }).click(),
    ]);
    return {
      name: download.suggestedFilename(),
      text: await readFile(await download.path(), "utf8"),
    };
  };
  const proposals = await csv("Download proposals (CSV)");
  expect(proposals.name).toBe(`${CALL}-submissions.csv`);
  for (const title of titles) expect(proposals.text).toContain(title);
  const people = await csv("Download people (CSV)");
  expect(people.name).toBe(`${CALL}-contributors.csv`);
  expect(people.text).toContain("Panelist Three");

  // Format names follow the interface language.
  await page.goto(`/es/c/${CALL}/manage`);
  await expect(page.getByText(/^Panel o mesa redonda · Enviada/)).toBeVisible();

  // A long list comes a page at a time.
  await page.goto("/en/c/sandbox/manage");
  const status = page.getByText(/^Showing \d+ of \d+/);
  await expect(status).toHaveText(/^Showing 100 of \d+/);
  const total = Number(/of (\d+)/.exec((await status.textContent()) ?? "")?.[1]);
  expect(total).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Show more" }).click();
  const shown = Math.min(200, total);
  await expect(status).toHaveText(new RegExp(`^Showing ${shown} of ${total}`));
  await expect(page.locator("ul.cards > li")).toHaveCount(shown);
  await expect(page.locator("ul.cards > li").nth(100).getByRole("link")).toBeFocused();
});
