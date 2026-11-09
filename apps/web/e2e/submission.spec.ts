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
/** LEFT-TO-RIGHT MARK: invisible, and often pasted along with a name. */
const LRM = String.fromCodePoint(0x200e);
const NAME_INVALID =
  "Use letters or digits, at most 200 characters, without hidden formatting characters.";
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

/** The invitation link in the latest email to this address (keep it to open it later). */
async function invitationLink(request: APIRequestContext, email: string) {
  const sent = /https?:\/\/\S+#token=\S+/.exec((await latestMail(request, email)).text)?.[0];
  expect(sent, `an invitation link in the latest email to ${email}`).toBeTruthy();
  // The email may be in Spanish or Portuguese; open the same invitation in English for the test.
  return (sent as string).replace(/\/(es|pt)\/invitation#/, "/en/invitation#");
}

/** Open an invitation link in a fresh browser (no account needed). */
async function openInvitation(browser: Browser, link: string, flaky = false) {
  const page = await newPhone(browser);
  // A dropped connection is not a dead link: the page keeps the token and offers to try again.
  if (flaky) await page.route("**/api/invitations/info", (route) => route.abort());
  await page.goto(link);
  await expect(
    page.getByRole("heading", { level: 1, name: "Invitation to a proposal" }),
  ).toBeVisible();
  if (flaky) {
    await expect(page.getByText("We could not reach the server.")).toBeVisible();
    await expect(page).not.toHaveURL(/token=/);
    await page.unroute("**/api/invitations/info");
    await page.getByRole("button", { name: "Try again" }).click();
    // The invitation arrives as new content: its heading takes focus (not the page body).
    await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  }
  return page;
}

/** The token page's one status line says how the answer went and takes focus. */
async function expectAnswered(page: Page, text: string) {
  const status = page.getByRole("status");
  await expect(status).toContainText(text);
  await expect(status).toBeFocused();
}

/** Answer an invitation from the link in the email (or one kept earlier), in a fresh browser. */
async function answerByLink(
  browser: Browser,
  request: APIRequestContext,
  email: string,
  answer: "confirm" | "decline",
  opts: { name?: string; invitedName?: string; flaky?: boolean; link?: string } = {},
) {
  const page = await openInvitation(
    browser,
    opts.link ?? (await invitationLink(request, email)),
    opts.flaky,
  );
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
    await expectAnswered(page, "Thank you: you are confirmed.");
  } else {
    await page.getByRole("button", { name: "Decline" }).click();
    await expectAnswered(page, "You declined.");
  }
  await page.context().close();
}

/** The owner saves the form as a draft. */
async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
}

/** The owner invites someone, then waits until `listed` people are on the proposal. */
async function invite(
  page: Page,
  email: string,
  listed: number,
  opts: { name?: string; role?: string } = {},
) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  if (opts.name) await page.getByLabel("Name (optional)").fill(opts.name);
  if (opts.role) await page.getByLabel("Role", { exact: true }).selectOption(opts.role);
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.locator(".people > li")).toHaveCount(listed);
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
  // Focus is never dropped: the emptied email field is ready for the next address, and after a
  // removal the status line says who was removed.
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await invite(page, "e2e-removed@example.org", 3, { name: "Rita Removed" });
  await page.getByRole("button", { name: "Remove: Rita Removed" }).click();
  await expect(page.locator(".people > li")).toHaveCount(2);
  await expect(page.getByText("You removed Rita Removed from this proposal.")).toBeFocused();

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
  // A name the server does not accept is not a missing one: the field says what it needs.
  await name.fill("—");
  await co.getByRole("button", { name: "Confirm my participation" }).click();
  await expect(co.locator("#inv-name-error")).toHaveText(NAME_INVALID);
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("maxlength", "200");
  // An invisible mark pasted along with the name is dropped before sending.
  await name.fill(`Cora Coauthor${LRM}`);
  await co.getByRole("button", { name: "Confirm my participation" }).click();
  const confirmed = co.getByText("You are confirmed. The owner has been told.");
  await expect(confirmed).toBeVisible();
  // The Confirm button goes away: focus is on the outcome, not lost.
  await expect(confirmed).toBeFocused();

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

test("a new invitee must give their own name to confirm by link, and the owner then sees it", async ({
  page,
  request,
  browser,
}) => {
  await signIn(page, request, "e2e-names-owner@example.org");
  await setName(page, "Nadia Names Owner");
  await start(page, "Individual talk");
  await page.getByLabel("Title").fill("Names in their own words");
  await saveDraft(page);
  await invite(page, "e2e-nameless@example.org", 2, { name: "Typed By The Owner" });

  const invitee = await openInvitation(
    browser,
    await invitationLink(request, "e2e-nameless@example.org"),
  );
  // The server says this person has no name yet (nameNeeded): the field is required and empty.
  const name = invitee.getByLabel("Your name *", { exact: true });
  await expect(name).toHaveValue("");
  await expect(name).toHaveAttribute("aria-required", "true");
  await expect(
    invitee.getByText("The proposal's owner wrote your name as “Typed By The Owner”."),
  ).toBeVisible();
  await acceptAgreements(invitee);
  await invitee.getByRole("button", { name: "Confirm my participation" }).click();
  await expect(invitee.locator("#inv-name-error")).toHaveText("Enter your name to confirm.");
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expectAccessible(invitee);
  await name.fill("Nora Ownwords");
  await expect(invitee.locator("#inv-name-error")).toHaveCount(0);

  // A name the server refuses (no letter or digit) is not a dead link: the form and the token
  // stay, and the field says what it needs.
  const confirm = invitee.getByRole("button", { name: "Confirm my participation" });
  await name.fill("—");
  await confirm.click();
  await expect(invitee.locator("#inv-name-error")).toHaveText(NAME_INVALID);
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAttribute("maxlength", "200");
  await expect(invitee.getByText("This invitation link has expired")).toHaveCount(0);
  await expectAccessible(invitee);
  // An invisible mark pasted along with the name is dropped before sending.
  await name.fill(`Nora Ownwords${LRM}`);
  await confirm.click();
  await expectAnswered(invitee, "Thank you: you are confirmed.");
  await invitee.context().close();

  // The owner sees the name the invitee gave, never the one the owner typed.
  await page.reload();
  const row = page.locator(".people > li").filter({ hasText: "Nora Ownwords" });
  await expect(row.locator(".badge")).toHaveText("Confirmed");
  expect(await row.locator("strong").textContent()).toBe("Nora Ownwords");
  await expect(page.getByText("Typed By The Owner")).toHaveCount(0);
});

test("withdrawn work: a pending invitee can only decline by link, and a co-author can leave", async ({
  page,
  request,
  browser,
}) => {
  const title = "Withdrawn with company";
  await signIn(page, request, "e2e-withdraw-owner@example.org");
  await setName(page, "Wendy Withdraw Owner");
  await start(page, "Individual talk");
  const editor = page.url();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Abstract (anonymized)").fill(words(260));
  await saveDraft(page);
  await invite(page, "e2e-withdraw-pending@example.org", 2, { name: "Pat Pending" });
  // Kept for later: once the work is withdrawn, the latest email is the withdrawal notice.
  const pendingLink = await invitationLink(request, "e2e-withdraw-pending@example.org");
  await invite(page, "e2e-withdraw-co@example.org", 3, { name: "Typed Coauthor" });
  await answerByLink(browser, request, "e2e-withdraw-co@example.org", "confirm", {
    name: "Carla Confirmed",
  });

  await page.reload();
  await acceptAgreements(page);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Submitted. A receipt is on its way")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(page.locator(".badge.status-withdrawn")).toHaveText("Withdrawn");
  await expect(page.getByRole("button", { name: "Withdraw", exact: true })).toHaveCount(0);

  // The pending invitee is told without the title; their link now offers only Decline.
  const notice = await latestMail(request, "e2e-withdraw-pending@example.org");
  expect(notice.subject).toContain("was withdrawn");
  expect(notice.text).not.toContain(title);
  const pending = await openInvitation(browser, pendingLink);
  await expect(
    pending.getByText("This proposal was withdrawn. You can still decline the invitation."),
  ).toBeVisible();
  await expect(pending.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(pending.getByRole("button", { name: "Confirm my participation" })).toHaveCount(0);
  await expect(pending.getByLabel(/^Your name/)).toHaveCount(0);
  await expect(pending.getByRole("checkbox")).toHaveCount(0);
  await expectAccessible(pending);
  // While the answer is on its way, Decline keeps focus and refuses repeat presses.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const answers: string[] = [];
  await pending.route("**/api/invitations/answer", async (route) => {
    answers.push(route.request().url());
    await held;
    await route.continue();
  });
  const decline = pending.getByRole("button", { name: "Decline" });
  await decline.focus();
  await pending.keyboard.press("Enter");
  await expect(decline).toHaveAttribute("aria-disabled", "true");
  await expect(decline).toBeFocused();
  await pending.keyboard.press("Enter");
  release();
  await expectAnswered(pending, "You declined.");
  expect(answers).toHaveLength(1);
  await pending.context().close();

  // The confirmed co-author can still leave the withdrawn proposal from the app.
  const co = await newPhone(browser);
  await signIn(co, request, "e2e-withdraw-co@example.org");
  await co.goto(editor);
  await expect(co.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(co.locator(".badge.status-withdrawn")).toHaveText("Withdrawn");
  await expect(co.getByRole("button", { name: "Decline" })).toHaveCount(0);
  await expectAccessible(co);
  co.once("dialog", (dialog) => dialog.accept());
  await co.getByRole("button", { name: "Leave this proposal" }).click();
  await expect(co.getByText("You left this proposal. The owner has been told.")).toBeVisible();
  await co.context().close();
});

test("reordering around a declined panelist: Move down changes the order, which a reload keeps", async ({
  page,
  request,
  browser,
}) => {
  await signIn(page, request, "e2e-order-owner@example.org");
  await setName(page, "Oscar Order Owner");
  await start(page, "Panel or roundtable");
  await page.getByLabel("Title").fill("Panel in a new order");
  // The owner's name in the abstract leaves a self-identification warning for the chairs.
  await page
    .getByLabel("Session abstract (anonymized)")
    .fill(`${words(380)} as Oscar Order Owner argued`);
  await saveDraft(page);
  await invite(page, "e2e-order-a@example.org", 2, { name: "Ada Declines", role: "panelist" });
  await answerByLink(browser, request, "e2e-order-a@example.org", "decline");

  // The declined row keeps its slot on the server; the owner's list shows only live people.
  await page.reload();
  await expect(page.locator(".people > li")).toHaveCount(1);
  await invite(page, "e2e-order-b@example.org", 2, { name: "Bea Second", role: "panelist" });
  await invite(page, "e2e-order-c@example.org", 3, { name: "Cy Third", role: "panelist" });
  const order = page.locator(".people > li strong");
  await expect(order).toHaveText(["Oscar Order Owner", "Bea Second", "Cy Third"]);
  await page.getByRole("button", { name: "Move down: Bea Second" }).click();
  await expect(order).toHaveText(["Oscar Order Owner", "Cy Third", "Bea Second"]);
  await page.reload();
  await expect(order).toHaveText(["Oscar Order Owner", "Cy Third", "Bea Second"]);

  // Submitted with three people; one then declines, which leaves the panel short (see Manage).
  const thirdLink = await invitationLink(request, "e2e-order-c@example.org");
  await acceptAgreements(page);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Submitted. A receipt is on its way")).toBeVisible();
  await answerByLink(browser, request, "e2e-order-c@example.org", "decline", { link: thirdLink });
});

test("a co-author's bio longer than the call's limit gets a note in the owner's editor", async ({
  page,
  request,
  browser,
}) => {
  // elo2027-open keeps ELO 2027's rules.bio.maxWords (300).
  await signIn(page, request, "e2e-bio-owner@example.org");
  await setName(page, "Bianca Bio Owner");
  await start(page, "Individual talk");
  await page.getByLabel("Title").fill("Bios at length");
  await saveDraft(page);
  await invite(page, "e2e-bio-co@example.org", 2, { name: "Typed Bio Person" });
  await answerByLink(browser, request, "e2e-bio-co@example.org", "confirm", {
    name: "Leo Longbio",
  });

  const longNote = page.getByText(/^Some bios are longer than 300 words\./);
  await page.reload();
  await expect(
    page.locator(".people > li").filter({ hasText: "Leo Longbio" }).locator(".badge"),
  ).toHaveText("Confirmed");
  // The check has loaded (nobody has a bio yet), and no bio is too long.
  await expect(page.getByText("Some people have not added a bio yet")).toBeVisible();
  await expect(longNote).toHaveCount(0);

  const co = await newPhone(browser);
  await signIn(co, request, "e2e-bio-co@example.org");
  await co.getByLabel("Bio in English").fill(words(320));
  await co.getByRole("button", { name: "Save profile" }).click();
  await expect(co.getByText("Profile saved.")).toBeVisible();
  await co.context().close();

  await page.reload();
  await expect(longNote).toHaveText(
    "Some bios are longer than 300 words. Each person can shorten their own in Your account.",
  );
  await expectAccessible(page);
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
  // Problems are named in the interface language, never as codes (the panel is a person short).
  const card = (title: string) =>
    page.locator("ul.cards > li").filter({ has: page.getByRole("link", { name: title }) });
  await expect(card("Panel in a new order").locator(".notice")).toHaveText(
    "Problems: Wrong number of people, Self-identification warning",
  );
  await expect(page.locator("ul.cards .notice").filter({ hasText: /_/ })).toHaveCount(0);
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
  await expect(
    card("Panel on platforms").getByText(/^Panel o mesa redonda · Enviada/),
  ).toBeVisible();
  await expect(card("Panel in a new order").locator(".notice")).toHaveText(
    "Problemas: Número de personas incorrecto, Aviso de autoidentificación",
  );

  // A long list comes a page at a time.
  const LIST = "/api/conferences/sandbox/submissions";
  const isMore = (url: URL) => url.pathname === LIST && url.searchParams.has("cursor");
  const isSearch = (url: URL) => url.pathname === LIST && url.searchParams.has("q");
  const firstPage = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return url.pathname === LIST && !url.searchParams.has("cursor");
  });
  await page.goto("/en/c/sandbox/manage");
  const listed = ((await (await firstPage).json()) as { items: { id: string }[] }).items;
  // The overview counts what was sent in; only the status line says what is shown.
  await expect(page.getByText(/^Proposals received: \d+$/)).toBeVisible();
  await expect(page.getByText(/\d+ shown$/)).toHaveCount(0);
  const status = page.getByText(/^Showing \d+ of \d+/);
  await expect(status).toHaveText(/^Showing 100 of \d+/);
  const total = Number(/of (\d+)/.exec((await status.textContent()) ?? "")?.[1]);
  expect(total).toBeGreaterThan(100);
  const cards = page.locator("ul.cards > li");
  const more = page.getByRole("button", { name: "Show more" });

  // A cursor the server refuses (sealed under a key it no longer has, after SECRET_KEY changed):
  // the list stays, and the page says it has changed.
  await page.route(isMore, (route) =>
    route.fulfill({
      status: 400,
      json: { error: "invalid", issues: [{ path: "cursor", message: "unknown cursor" }] },
    }),
  );
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(
      "The list has changed since it was loaded. Reload the page to see it as it is now.",
    ),
  ).toBeVisible();
  await expect(cards).toHaveCount(100);
  await expect(more).toBeFocused();
  await page.unroute(isMore);

  // A page that repeats proposals already listed adds each proposal once.
  await page.route(isMore, async (route) => {
    const response = await route.fetch();
    const page2 = (await response.json()) as { items: unknown[] };
    await route.fulfill({
      response,
      json: { ...page2, items: [...listed.slice(-3), ...page2.items] },
    });
  });
  await page.keyboard.press("Enter");
  const shown = Math.min(200, total);
  await expect(status).toHaveText(new RegExp(`^Showing ${shown} of ${total}`));
  await expect(cards).toHaveCount(shown);
  const ids = await page.locator("ul.cards h2 a").evaluateAll((links) => links.map((a) => a.id));
  expect(new Set(ids).size).toBe(shown);
  await expect(cards.nth(100).getByRole("link")).toBeFocused();
  await page.unroute(isMore);

  // While a page is on its way, "Show more" keeps focus. If the filter changes before it
  // arrives, the page is dropped and focus stays with the chair, not on a row.
  await page.goto("/en/c/sandbox/manage");
  await expect(status).toHaveText(/^Showing 100 of \d+/);
  let releaseMore = () => {};
  const moreHeld = new Promise<void>((resolve) => {
    releaseMore = resolve;
  });
  let nextTitle = "";
  await page.route(isMore, async (route) => {
    const response = await route.fetch();
    const page2 = (await response.json()) as { items: { title: string }[] };
    nextTitle = page2.items[0]?.title ?? "";
    await moreHeld;
    await route.fulfill({ response, json: page2 });
  });
  let releaseSearch = () => {};
  const searchHeld = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route(isSearch, async (route) => {
    await searchHeld;
    await route.continue();
  });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("aria-disabled", "true");
  await expect(more).toBeFocused();
  await expect.poll(() => nextTitle).not.toBe("");
  await page.getByLabel("Search titles").fill(nextTitle);
  const apply = page.getByRole("button", { name: "Apply filters" });
  await apply.click();
  const stalePage = page.waitForResponse((r) => isMore(new URL(r.url())));
  releaseMore();
  await stalePage;
  releaseSearch();
  await expect(page.getByRole("link", { name: nextTitle }).first()).toBeVisible();
  await expect(status).toHaveText(/^Showing \d+ of \d+/);
  // Give a stray focus move time to happen before checking that none did.
  await page.waitForTimeout(300);
  await expect(apply).toBeFocused();
  await page.unroute(isMore);
  await page.unroute(isSearch);
});
