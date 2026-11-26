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

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
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

/** The latest sign-in email to an address, by its kind: other email may reach it meanwhile. */
async function signInMail(request: APIRequestContext, email: string) {
  const mail = await request.get(
    `/api/_test/outbox/latest?kind=magic_link&to=${encodeURIComponent(email)}`,
  );
  return ((await mail.json()) as { text: string }).text;
}

/**
 * Sign in as someone new to the call does (spec 02, §1.11): signed out on the conference's
 * page, choose a format, "Start this proposal", and sign in on the start page itself, with the
 * link from the email. It leads back to the start page, with that format chosen.
 *
 * This is the one sign-in in the browser tests that goes the whole way by the emailed link from
 * a page other than the sign-in page. It takes the place of a sign-in this file made anyway:
 * the server rations them, and the suite is close to the limit.
 */
async function signInToStart(
  page: Page,
  request: APIRequestContext,
  email: string,
  format: string,
) {
  const conference = (await (await request.get(`/api/conferences/${CALL}`)).json()) as {
    config: { submissionTypes: { key: string; name: Record<string, string> }[] };
  };
  const formats = conference.config.submissionTypes;
  const chosen = formats.find((type) => type.name.en === format);
  if (!chosen) throw new Error(`the call takes no format named ${format}`);
  // Not the first: the first is what the start page chooses when it is told nothing.
  expect(formats[0]?.key).not.toBe(chosen.key);
  const here = `/en/c/${CALL}/submit?format=${chosen.key}`;

  await page.goto(`/en/c/${CALL}`);
  await page.getByRole("combobox", { name: "Format", exact: true }).selectOption(chosen.key);
  await page.locator(".format-panel").getByRole("link", { name: "Start this proposal" }).click();
  await expect(page).toHaveURL(here);

  // Nobody is signed in. The page says why to sign in and which format was chosen, and has
  // the sign-in form on it: there is no other page to go to first.
  await expect(page.getByRole("heading", { level: 1, name: "Start a proposal" })).toBeVisible();
  await expect(page.getByText("Sign in to start a proposal.")).toBeVisible();
  await expect(page.getByText(`Selected format: ${format}`)).toBeVisible();
  await expect(
    page.getByText("We will email you a link that signs you in. No password needed."),
  ).toBeVisible();
  await expect(page.getByText("The link in the email brings you back to this page.")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.locator('main a[href$="/sign-in"]')).toHaveCount(0);
  // The header has "Sign in" where a name would be, and no pages of one's own to offer.
  const header = page.locator(".site-header");
  await expectTouchTarget(header.getByRole("link", { name: "Sign in" }));
  await expect(header.getByRole("link", { name: "My submissions" })).toHaveCount(0);
  const send = page.getByRole("button", { name: "Email me a link" });
  await expectTouchTarget(send);
  await expectTouchTarget(page.getByText("I already have a code"));
  await expectAccessibleInBothThemes(page);
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByLabel("Email address").fill(email);
  await send.click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  // The code from the same email can be typed here, as on the sign-in page.
  await expect(page.getByLabel("Code from the email")).toBeVisible();
  await expectAccessible(page);

  // The link names this page beside its token, in the fragment, which no server is sent.
  const link = /https?:\/\/\S+/.exec(await signInMail(request, email))?.[0] ?? "";
  const sent = new URL(link);
  expect(sent.origin).toBe(new URL(page.url()).origin);
  expect(sent.pathname + sent.search).toBe("/en/auth/verify");
  const fragment = new URLSearchParams(sent.hash.slice(1));
  expect([...fragment.keys()]).toEqual(["token", "next"]);
  expect(fragment.get("next")).toBe(here);
  expect(link.endsWith(`&next=${encodeURIComponent(here)}`)).toBe(true);

  // Opening it signs nobody in: it says who, and waits for the tap. Nothing of the fragment
  // stays in the address bar.
  await page.goto(link);
  await expect(page.getByText(`This link signs you in as ${email}.`)).toBeVisible();
  await expect(page).toHaveURL(/\/en\/auth\/verify$/);
  expect((await page.request.get("/api/me")).status()).toBe(401);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Signed in, and back where they were going: the start form, with their format chosen.
  await expect(page).toHaveURL(here);
  const heading = page.getByRole("heading", { level: 1, name: "Start a proposal" });
  await expect(heading).toBeFocused();
  // The format they chose is the one the form is for, said at its top; the other formats are
  // not on the page, and the rest of the form follows at once.
  const box = page.getByRole("group", { name: "Format" });
  await expect(box.getByText(`Selected format: ${format}`)).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole("list", { name: "Format" })).toHaveCount(0);
  await expect(box.getByRole("button", { name: "Choose another format" })).toBeVisible();
  await expect(page.getByLabel("Language of your abstract")).toBeInViewport();
  await expect(page.getByRole("button", { name: `Start: ${format}` })).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveCount(0);
  expect((await page.request.get("/api/me")).status()).toBe(200);
  // The header says who is signed in, at its right end: by their address, until they say
  // what they are called. They have no proposals yet, so it offers no "My submissions".
  await expectTouchTarget(
    header.getByRole("link", { name: `Your account: ${email}`, exact: true }),
  );
  await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "My submissions" })).toHaveCount(0);
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

async function setName(page: Page, name: string) {
  await page.goto("/en/me");
  await page.getByLabel("Your name, as it should appear").fill(name);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  // The details at the top follow the saved profile, and so does the name in the header,
  // which is the link to this page.
  await expect(page.locator(".details")).toContainText(name);
  await expect(
    page.locator(".site-header").getByRole("link", { name: `Your account: ${name}`, exact: true }),
  ).toHaveAttribute("aria-current", "page");
}

async function start(page: Page, format: string) {
  await page.goto(`/en/c/${CALL}`);
  await page.getByRole("link", { name: "Start a proposal" }).click();
  // The page asks for the format first: one row to a format, and pressing one chooses it.
  await page
    .getByRole("list", { name: "Format" })
    .getByRole("button", { name: new RegExp(`^${format} · `) })
    .click();
  await page.getByRole("radio", { name: "In person" }).check();
  await page.getByRole("button", { name: /^Start: / }).click();
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
    // Confirming signed nobody in: the page has the sign-in form on it, where it used to link
    // to the sign-in page (spec 02, §1.11). The link it asks for leads to "Your account", never
    // back to this page, which is nothing without its token: the request names no address.
    // It is answered here, and reaches no server.
    expect((await page.request.get("/api/me")).status()).toBe(401);
    let asked: unknown;
    await page.route("**/api/auth/request-link", (route) => {
      asked = route.request().postDataJSON();
      return route.fulfill({ status: 202, json: { ok: true } });
    });
    await expect(page.getByLabel("Email address")).toHaveValue("");
    await expect(page.locator('main a[href$="/sign-in"]')).toHaveCount(0);
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByText("Check your email.")).toBeVisible();
    expect(asked).toEqual({ email, lang: "en" });
    await expect(page).not.toHaveURL(/token=/);
    await expectAccessible(page);
  } else {
    await page.getByRole("button", { name: "Decline" }).click();
    await expectAnswered(page, "You declined.");
    // Someone who declined is offered no sign-in.
    await expect(page.getByLabel("Email address")).toHaveCount(0);
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

const RESTORED = "Your unsaved changes were restored from this device. Review them, then save.";

/** The unsaved text the app keeps in this browser (apps/web/src/unsaved.ts), by storage key. */
const unsavedKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("elochair:unsaved:")));

/** Everything this browser's store holds for the app, keys and values, as one text. */
const wholeStore = (page: Page) =>
  page.evaluate(() => JSON.stringify(Object.entries(localStorage)));

/**
 * Collects what a screen reader would announce: text that arrives in a live region which was
 * already on the page. (A region that is rendered together with its text is not announced.)
 */
async function listenForAnnouncements(page: Page) {
  await page.addInitScript(() => {
    const heard: string[] = [];
    Object.assign(window, { heard });
    new MutationObserver((records) => {
      for (const record of records) {
        const at = record.target instanceof Element ? record.target : record.target.parentElement;
        const region = at?.closest("[aria-live], [role=status]");
        if (region?.textContent) heard.push(region.textContent);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

const announcements = (page: Page) =>
  page.evaluate(() => (window as unknown as { heard: string[] }).heard.join("\n"));

test("submit a talk from a phone: word count, self-identification, co-author, agreements, receipt", async ({
  page,
  request,
  browser,
}) => {
  const owner = "e2e-owner@example.org";
  await signIn(page, request, owner);
  await setName(page, "Ana Testing Owner");
  await page.goto(`/en/c/${CALL}`);
  // The call's page invites: it says the call is open, and when proposals are due.
  await expect(page.locator(".hero-eyebrow")).toContainText("Call for proposals");
  await expect(page.getByText("Proposals due")).toBeVisible();
  await expectAccessibleInBothThemes(page);
  await start(page, "Paper");
  await expectAccessible(page);

  await page.getByLabel("Title").fill("Poems that read");
  // The call gives papers a maximum length and no minimum.
  await page.getByLabel("Abstract (anonymized)").fill(`${words(305)} as Ana Testing Owner argued`);
  await expect(page.locator("#abstract-count")).toHaveText("310 words: at most 300 allowed");
  await page.getByLabel("Abstract (anonymized)").fill(`${words(240)} as Ana Testing Owner argued`);
  await expect(page.locator("#abstract-count")).toHaveText("245 words (at most 300)");
  await expect(page.getByText("The abstract mentions an author's name.")).toBeVisible();
  // Saved, the server's check finds the name too; rewording clears the warning before saving.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(page.getByText("The abstract mentions an author's name.")).toBeVisible();
  await page.getByLabel("Abstract (anonymized)").fill(words(260));
  await expect(page.locator("#abstract-count")).toHaveText("260 words (at most 300)");
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
  await start(page, "Panel");
  await page.getByLabel("Title").fill("Panel on platforms");
  // A panel is a rationale of up to 150 words and an abstract for each of its papers.
  await page.getByLabel("Rationale for the panel (anonymized)").fill(words(120));
  await page.getByLabel("Abstract of each paper or talk (anonymized)").fill(words(420));
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
  await start(page, "Work for the exhibition");
  const editor = page.url();
  await page.getByLabel("Title").fill("A garden of forking links");
  await page.getByLabel("Abstract", { exact: true }).fill(words(280));
  await page
    .getByLabel("Link to the work or to documentation of it (optional)")
    .fill("https://example.net/garden");

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

test("a workshop says how many people it is for, within the call's 15 to 30", async ({
  page,
  request,
}) => {
  // Changed with spec 02, §1.11: this author used to sign in on the sign-in page. They now
  // arrive signed out, choose the workshop on the conference's page, and sign in on the start
  // page with the emailed link, which brings them back to it with the workshop chosen.
  await signInToStart(page, request, "e2e-workshop@example.org", "Workshop");
  await setName(page, "Wanda Workshop");
  await page.goto(`/en/c/${CALL}`);
  // What the start page is told about the call: the formats below are held to it.
  const told = page
    .waitForResponse((r) => new URL(r.url()).pathname === `/api/conferences/${CALL}` && r.ok())
    .then(
      (r) =>
        r.json() as Promise<{
          config: {
            submissionTypes: {
              key: string;
              name: Record<string, string>;
              description: Record<string, string>;
            }[];
          };
        }>,
    );
  await page.getByRole("link", { name: "Start a proposal" }).click();
  // Nothing named a format, so the page asks for one first, and for nothing else. Every
  // format the call takes here is there with its description, all at once: nobody has to
  // choose a format to read what it is. (Changed twice on the owner's word: the page used to
  // say only what the chosen format is, and then to keep every format on the page after one
  // was chosen.) The one the call takes by email is not offered.
  const formats = (await told).config.submissionTypes;
  expect(formats.length).toBeGreaterThan(1);
  const list = page.getByRole("list", { name: "Format" });
  await expect(page.getByText("Choose a format for your proposal.")).toBeVisible();
  await expect(list.getByRole("button")).toHaveCount(formats.length);
  await expect(list.getByRole("button", { name: /Curatorial/ })).toHaveCount(0);
  await expect(list.locator('[aria-current="true"]')).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByLabel("Language of your abstract")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Start: / })).toHaveCount(0);
  // A format's name and lengths are what its row is called, and its description is read
  // after them.
  await expect(
    list.getByRole("button", { name: "Lightning talk · up to 150 words · 5 minutes" }),
  ).toBeVisible();
  const beginning = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const named = (format: (typeof formats)[number]) =>
    list.getByRole("button", { name: beginning(`${format.name.en} · `) });
  /** A format's row: its name is the button, and the whole row is pressed as that button is. */
  const row = (format: (typeof formats)[number]) =>
    list.locator("li", {
      has: page.getByRole("button", { name: beginning(`${format.name.en} · `) }),
    });
  for (const format of formats) {
    const about = format.description.en ?? "";
    expect(about, `a description of ${format.key}`).not.toBe("");
    await expect(page.getByText(about, { exact: true })).toHaveCount(1);
    await expect(page.getByText(about, { exact: true })).toBeVisible();
    await expect(named(format)).toHaveAccessibleDescription(about);
    await expectTouchTarget(row(format));
  }
  // On a phone a description stands under its format's name; nothing scrolls sideways; and
  // both themes pass.
  const [first, last] = [formats[0], formats.at(-1)] as [
    (typeof formats)[number],
    (typeof formats)[number],
  ];
  const places = (format: (typeof formats)[number]) =>
    row(format).evaluate((el) => {
      const at = (part: string) => el.querySelector(part)?.getBoundingClientRect();
      const [name, about] = [at(".format-row-name"), at(".format-row-about")];
      return {
        nameLeft: Math.round(name?.left ?? 0),
        aboutLeft: Math.round(about?.left ?? 0),
        under: (about?.top ?? 0) >= (name?.bottom ?? 0),
      };
    });
  expect(await places(first)).toMatchObject({ under: true });
  await expectAccessibleInBothThemes(page);
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);
  // Where there is room the names stand in one column and the descriptions in another,
  // each at one edge for every format.
  await page.setViewportSize({ width: 1280, height: 900 });
  const wide = await Promise.all(formats.map(places));
  expect(new Set(wide.map((at) => at.nameLeft)).size).toBe(1);
  expect(new Set(wide.map((at) => at.aboutLeft)).size).toBe(1);
  expect(wide.every((at) => !at.under && at.aboutLeft > at.nameLeft)).toBe(true);
  await expectAccessible(page);
  await page.setViewportSize({ width: 390, height: 844 });

  // Pressing a row, anywhere on it, chooses that format, and the list gives way to the rest
  // of the form: the other formats are gone from the page. What took the list's place says
  // which format it is, and takes the focus.
  await row(last).click();
  await expect(list).toHaveCount(0);
  const chosen = page.getByRole("group", { name: "Format" });
  await expect(chosen.getByText(`Selected format: ${last.name.en}`)).toBeFocused();
  await expect(chosen).toContainText(last.description.en ?? "");
  await expect(page.getByText(first.description.en ?? "", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Language of your abstract")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(3); // how you take part
  await expect(page.getByRole("button", { name: `Start: ${last.name.en}` })).toBeVisible();
  await expectAccessibleInBothThemes(page);
  await expectNoHorizontalScroll(page);
  // "Choose another format" brings the list back, with theirs marked and in focus, and what
  // they had filled in is kept.
  await page.getByRole("radio", { name: "Online" }).check();
  const another = chosen.getByRole("button", { name: "Choose another format" });
  await expectTouchTarget(another);
  await another.click();
  await expect(named(last)).toBeFocused();
  await expect(named(last)).toHaveAttribute("aria-current", "true");
  await expect(row(last)).toContainText("Selected");
  await expect(list.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Start: / })).toHaveCount(0);
  await expectAccessibleInBothThemes(page);
  await list.getByRole("button", { name: /^Workshop · / }).click();
  await expect(chosen.getByText("Selected format: Workshop")).toBeFocused();
  await expect(page.getByRole("radio", { name: "Online" })).toBeChecked();
  await page.getByRole("radio", { name: "In person" }).check();
  await page.getByRole("button", { name: "Start: Workshop" }).click();
  await expect(page).toHaveURL(/\/en\/s\/[0-9a-f-]+$/);

  await page.getByLabel("Title").fill("Mapping attention by hand");
  await page.getByLabel("Description of the workshop and its goals (anonymized)").fill(words(180));
  const people = page.getByLabel("Expected number of participants (between 15 and 30)");
  await people.fill("40");
  await page.getByLabel("Tools and room conditions you will need").fill("Tables, paper and pens.");
  await saveDraft(page);
  await acceptAgreements(page);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  // Refused with the reason beside the field, and the proposal stays a draft.
  await expect(page.getByText("Enter a number from 15 to 30.").first()).toBeVisible();
  await expect(page.locator(".badge.status-draft")).toBeVisible();
  await expectAccessible(page);

  // People are counted whole: a fraction inside the range is refused too.
  await people.fill("15.5");
  await saveDraft(page);
  await acceptAgreements(page);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Enter a whole number.").first()).toBeVisible();
  await expect(page.locator(".badge.status-draft")).toBeVisible();

  // Typed and not saved, the head count is kept in this browser like any other answer. After a
  // reload it is back as the number it was, and the server takes it as one.
  await people.fill("20");
  await expect.poll(() => unsavedKeys(page)).toHaveLength(1);
  await page.reload();
  await expect(people).toHaveValue("20");
  await expect(page.getByText(RESTORED)).toBeVisible();
  await saveDraft(page);
  await expect.poll(() => unsavedKeys(page)).toEqual([]);
  await acceptAgreements(page);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Submitted. A receipt is on its way")).toBeVisible();
});

test("invitees answer in the app: asked for their own name, one confirms then leaves, one declines", async ({
  page,
  request,
  browser,
}) => {
  const owner = "e2e-inapp-owner@example.org";
  await signIn(page, request, owner);
  await setName(page, "Olga Inapp Owner");
  await start(page, "Paper");
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
  await start(page, "Paper");
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
  await start(page, "Paper");
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
  await start(page, "Panel");
  await page.getByLabel("Title").fill("Panel in a new order");
  // The owner's name in the rationale leaves a self-identification warning for the chairs.
  await page
    .getByLabel("Rationale for the panel (anonymized)")
    .fill(`${words(100)} as Oscar Order Owner argued`);
  await page.getByLabel("Abstract of each paper or talk (anonymized)").fill(words(450));
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
  await start(page, "Paper");
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

test("unsaved text in a proposal survives a reload or a lost tab, until it is saved or discarded", async ({
  page,
  request,
  browser,
}) => {
  await listenForAnnouncements(page);
  await signIn(page, request, "e2e-unsaved@example.org");
  await setName(page, "Uma Unsaved");
  // The header offers "My submissions" once there is one, and no longer when it is deleted.
  const mine = page.locator(".site-header").getByRole("link", { name: "My submissions" });
  await expect(mine).toHaveCount(0);
  await start(page, "Paper");
  await expect(mine).toBeVisible();
  const editor = page.url();
  const title = page.getByLabel("Title");
  const abstract = page.getByLabel("Abstract (anonymized)");
  const restored = page.getByText(RESTORED);
  await title.fill("Reading in the dark");
  await saveDraft(page);
  expect(await unsavedKeys(page)).toEqual([]);

  // Typed, not saved, and the page goes away at once: the text is written on the way out.
  await title.fill("Reading in the dark, again");
  await abstract.fill(words(40));
  await page.reload();
  await expect(title).toHaveValue("Reading in the dark, again");
  await expect(abstract).toHaveValue(words(40));
  await expect(restored).toBeVisible();
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();
  // The notice is announced, and focus is not taken from wherever the person is.
  await expect.poll(() => announcements(page)).toContain(RESTORED);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  const discard = page.getByRole("button", { name: "Discard unsaved changes" });
  await expectTouchTarget(discard);
  await expectAccessibleInBothThemes(page);

  // Discarding goes back to the saved text; the status line says so and takes focus.
  await discard.click();
  await expect(title).toHaveValue("Reading in the dark");
  await expect(abstract).toHaveValue("");
  await expect(page.getByText("Unsaved changes discarded.")).toBeFocused();
  await expect(restored).toHaveCount(0);
  await page.reload();
  await expect(title).toHaveValue("Reading in the dark");
  await expect(restored).toHaveCount(0);

  // A tab that dies says no goodbye: after a pause in typing, the text is already kept. The
  // proposal opened again (here in a second tab, the first one untouched) has it.
  await title.fill("Reading in the dark, once more");
  await expect.poll(() => unsavedKeys(page)).toHaveLength(1);
  const again = await page.context().newPage();
  await again.goto(editor);
  await expect(again.getByLabel("Title")).toHaveValue("Reading in the dark, once more");
  await expect(again.getByText(RESTORED)).toBeVisible();
  await again.close();

  // Saving removes what was kept: a reload shows the saved text, and no notice.
  await saveDraft(page);
  await expect.poll(() => unsavedKeys(page)).toEqual([]);
  await page.reload();
  await expect(title).toHaveValue("Reading in the dark, once more");
  await expect(restored).toHaveCount(0);

  // Unsaved changes from before the proposal changed elsewhere (an invitee answered): they come
  // back with the same choice as after a stale save, announced as an alert, without taking focus.
  await invite(page, "e2e-unsaved-invitee@example.org", 2);
  await title.fill("Reading in the dark, revised");
  await expect.poll(() => unsavedKeys(page)).toHaveLength(1);
  await answerByLink(browser, request, "e2e-unsaved-invitee@example.org", "decline");
  await page.reload();
  const stale = page.getByRole("alert").filter({ hasText: "This proposal was changed elsewhere" });
  await expect(stale).toContainText("Your unsaved changes were restored from this device.");
  await expect(stale).toContainText("Your unsaved changes are still in the form.");
  await expect(title).toHaveValue("Reading in the dark, revised");
  await expect(restored).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  // Until the owner has chosen, another reload asks again.
  await page.reload();
  await expect(stale).toBeVisible();
  await expectAccessibleInBothThemes(page);
  await page.getByRole("button", { name: "Load the latest version and keep my changes" }).click();
  await expect(page.getByText("Loaded the latest version and kept your changes.")).toBeVisible();
  await expect(title).toHaveValue("Reading in the dark, revised");
  // The latest version came with it: the invitee who declined is off the list.
  await expect(page.locator(".people > li")).toHaveCount(1);
  await saveDraft(page);
  await page.reload();
  await expect(title).toHaveValue("Reading in the dark, revised");
  await expect(stale).toHaveCount(0);
  await expect(restored).toHaveCount(0);

  // Deleting the draft removes what was unsaved for it.
  await title.fill("Reading in the dark, never saved");
  await expect.poll(() => unsavedKeys(page)).toHaveLength(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete draft" }).click();
  await expect(page).toHaveURL(/\/en\/my$/);
  expect(await unsavedKeys(page)).toEqual([]);
  await expect(mine).toHaveCount(0);

  // Signing out straight after typing: the form on screen does not write its text back.
  await page.locator(".site-header").getByRole("link", { name: "Your account" }).click();
  await page.getByLabel("Bio in English").fill("Uma reads in the dark.");
  // The header forgets who was signed in when they sign out, not when the server next
  // answers it: here its question after the sign-out waits, and then fails.
  const header = page.locator(".site-header");
  await expect(
    header.getByRole("link", { name: "Your account: Uma Unsaved", exact: true }),
  ).toBeVisible();
  let fail: () => void = () => {};
  const failing = new Promise<void>((resolve) => {
    fail = resolve;
  });
  let failed = 0;
  await page.route("**/api/me/menu", async (route) => {
    await failing;
    await route.fulfill({ status: 500, json: { error: "made_up" } });
    failed += 1;
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(header.getByText("Uma Unsaved")).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Your account" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "My submissions" })).toHaveCount(0);
  // Give a late write time to happen before checking that none did.
  await page.waitForTimeout(600);
  expect(await unsavedKeys(page)).toEqual([]);
  // The answer that fails brings nobody back: the header shows neither her nor "Sign in",
  // which it has not been told. The next page asks again, and is told that nobody is.
  fail();
  await expect.poll(() => failed).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await expect(header.getByText("Uma Unsaved")).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await page.unroute("**/api/me/menu");
  await page.goto("/en/my");
  await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("an unsaved bio survives a reload; signing out removes it, and another account never sees it", async ({
  page,
  request,
}) => {
  const ana = "e2e-unsaved-ana@example.org";
  const bruno = "e2e-unsaved-bruno@example.org";
  await listenForAnnouncements(page);
  await signIn(page, request, ana);
  await setName(page, "Ana Unsaved");
  const bio = page.getByLabel("Bio in English");
  const restored = page.getByText(RESTORED);

  await bio.fill("Ana writes poems for machines.");
  await page.getByLabel("Pronouns (optional)").fill("she");
  await page.reload();
  await expect(bio).toHaveValue("Ana writes poems for machines.");
  await expect(page.getByLabel("Pronouns (optional)")).toHaveValue("she");
  await expect(restored).toBeVisible();
  await expect.poll(() => announcements(page)).toContain(RESTORED);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  const discard = page.getByRole("button", { name: "Discard unsaved changes" });
  await expectTouchTarget(discard);
  await expectAccessibleInBothThemes(page);

  await discard.click();
  await expect(bio).toHaveValue("");
  await expect(page.getByLabel("Pronouns (optional)")).toHaveValue("");
  await expect(page.getByLabel("Your name, as it should appear")).toHaveValue("Ana Unsaved");
  await expect(page.getByText("Unsaved changes discarded.")).toBeFocused();
  await expect(restored).toHaveCount(0);
  await expect.poll(() => unsavedKeys(page)).toEqual([]);

  // Saving removes what was kept.
  await bio.fill("Ana writes poems for machines.");
  await expect.poll(() => unsavedKeys(page)).toHaveLength(1);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await expect.poll(() => unsavedKeys(page)).toEqual([]);
  await page.reload();
  await expect(bio).toHaveValue("Ana writes poems for machines.");
  await expect(restored).toHaveCount(0);

  // Ana's session goes away without a sign-out (here: the browser forgets its cookies). Her
  // unsaved text stays in the browser, under her id: Bruno, signing in after her, sees his own
  // profile and nothing of hers.
  await bio.fill("Ana writes poems for machines, and for people.");
  await expect.poll(() => unsavedKeys(page)).toHaveLength(1);
  // She also left her profile open in a second tab, with the same unsaved text in it.
  const left = await page.context().newPage();
  await left.goto("/en/me");
  const leftBio = left.getByLabel("Bio in English");
  await expect(leftBio).toHaveValue("Ana writes poems for machines, and for people.");
  const anaSession = await page.context().cookies();
  await page.context().clearCookies();
  await signIn(page, request, bruno);
  await expect(page.getByRole("button", { name: "Save profile" })).toBeVisible();
  await expect(bio).toHaveValue("");
  await expect(restored).toHaveCount(0);
  expect(await unsavedKeys(page)).toHaveLength(1);

  // Unsaved text does not wait in the browser for whoever uses it next: signing out removes
  // Bruno's, and only his.
  await bio.fill("Bruno builds reading machines.");
  await expect.poll(() => unsavedKeys(page)).toHaveLength(2);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en\/$/);
  expect(await unsavedKeys(page)).toHaveLength(1);
  expect(await wholeStore(page)).not.toContain("Bruno builds");

  // Bruno's sign-out was his alone. Ana never signed out, and the tab she left open goes on
  // keeping what is typed in it.
  await leftBio.fill("Ana writes poems for machines, for people, and for herself.");
  await expect.poll(() => wholeStore(left)).toContain("and for herself.");
  expect(await unsavedKeys(left)).toHaveLength(1);
  await left.close();

  // Ana is back on her session (it was forgotten, never ended; signing in again would be one
  // more of the sign-in links the server rations). Her text is restored and nothing of Bruno's
  // is, and her own sign-out leaves nothing in the browser.
  await page.context().addCookies(anaSession);
  await page.goto("/en/me");
  await expect(bio).toHaveValue("Ana writes poems for machines, for people, and for herself.");
  await expect(restored).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en\/$/);
  expect(await unsavedKeys(page)).toEqual([]);
  // What stays after a sign-out is a random token for each of them: no word of theirs.
  const kept = await wholeStore(page);
  expect(kept).not.toContain("poems");
  expect(kept).not.toContain("machines");
});

const CONFLICT =
  "Your profile was saved somewhere else after you typed these changes on this device. The form shows the saved version. You can put your changes back on top of it, or discard them.";

/**
 * The same person saves another bio from another device. Here it goes straight to the server
 * from this session, so that nothing this browser keeps (apps/web/src/unsaved.ts) is touched.
 */
async function saveBioElsewhere(page: Page, bio: string) {
  const status = await page.evaluate(async (en) => {
    const { person } = await (await fetch("/api/me", { credentials: "same-origin" })).json();
    const { displayName, affiliation, country, languages, pronouns, orcid, bios } = person;
    const saved = await fetch("/api/me/profile", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName,
        affiliation,
        country,
        languages,
        pronouns,
        orcid,
        bios: { ...bios, en },
      }),
    });
    return saved.status;
  }, bio);
  expect(status).toBe(200);
}

test("an unsaved bio never replaces newer saved text unasked, and a sign-out in another tab ends it", async ({
  page,
  request,
}) => {
  await listenForAnnouncements(page);
  await signIn(page, request, "e2e-unsaved-dana@example.org");
  await setName(page, "Dana Unsaved");
  const bio = page.getByLabel("Bio in English");
  const pronouns = page.getByLabel("Pronouns (optional)");
  const conflict = page.getByText(CONFLICT);
  const save = page.getByRole("button", { name: "Save profile" });
  await bio.fill("Dana writes.");
  await save.click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  // Two devices. On this one she types and does not save; on another she saves a different bio.
  await bio.fill("Dana writes poems for machines.");
  await pronouns.fill("she");
  await expect.poll(() => unsavedKeys(page)).toHaveLength(1);
  await page.waitForTimeout(600);
  await saveBioElsewhere(page, "Dana builds reading machines.");
  await page.reload();

  // The form shows what is saved now. Her older text is offered, not laid over it; the change
  // made on a value that did not change elsewhere (the pronouns) is back as before.
  await expect(bio).toHaveValue("Dana builds reading machines.");
  await expect(pronouns).toHaveValue("she");
  await expect(conflict).toBeVisible();
  await expect(page.getByText("Dana writes poems for machines.")).toBeVisible();
  await expect(page.getByText(RESTORED)).toBeVisible();
  await expect.poll(() => announcements(page)).toContain(CONFLICT);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  const mine = page.getByRole("button", { name: "Put my changes back in the form" });
  const theirs = page.getByRole("button", {
    name: "Discard my changes and keep the saved version",
  });
  await expectTouchTarget(mine);
  await expectTouchTarget(theirs);
  // Nothing scrolls sideways at phone width, however long the text she is shown.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expectAccessibleInBothThemes(page);

  // Saving before she has chosen sends none of the older text: the bio stays as saved elsewhere,
  // and the choice is still there after another reload.
  await save.click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await page.waitForTimeout(600);
  await page.reload();
  await expect(bio).toHaveValue("Dana builds reading machines.");
  await expect(pronouns).toHaveValue("she");
  await expect(conflict).toBeVisible();
  await expect(page.getByText(RESTORED)).toHaveCount(0);

  // She chooses her own text: it goes into the form as an unsaved change, to review and save.
  await mine.click();
  await expect(bio).toHaveValue("Dana writes poems for machines.");
  await expect(
    page.getByText("Your changes are back in the form. Review them, then save."),
  ).toBeFocused();
  await expect(conflict).toHaveCount(0);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(bio).toHaveValue("Dana writes poems for machines.");
  await expect(page.getByText(RESTORED)).toBeVisible();
  await expect(conflict).toHaveCount(0);

  // The other choice, after the profile is saved elsewhere once more: the saved version stays.
  await saveBioElsewhere(page, "Dana reads.");
  await page.reload();
  await expect(bio).toHaveValue("Dana reads.");
  await expect(conflict).toBeVisible();
  await theirs.click();
  await expect(bio).toHaveValue("Dana reads.");
  await expect(page.getByText("Unsaved changes discarded.")).toBeFocused();
  await expect(conflict).toHaveCount(0);
  await expect.poll(() => unsavedKeys(page)).toEqual([]);

  // Two tabs of one browser. This one has unsaved text; she signs out in the other.
  await bio.fill("Dana reads aloud.");
  await expect.poll(() => unsavedKeys(page)).toHaveLength(1);
  const other = await page.context().newPage();
  await other.goto("/en/me");
  await expect(other.getByLabel("Bio in English")).toHaveValue("Dana reads aloud.");
  // Both tabs have her name in the header.
  const hers = { name: "Your account: Dana Unsaved", exact: true };
  const header = page.locator(".site-header");
  await expect(header.getByRole("link", hers)).toBeVisible();
  await expect(other.locator(".site-header").getByRole("link", hers)).toBeVisible();
  await other.getByRole("button", { name: "Sign out" }).click();
  await expect(other).toHaveURL(/\/en\/$/);
  expect(await unsavedKeys(other)).toEqual([]);
  // This tab, which nobody touched, hears of it: its header no longer has her name, and says
  // what the server now says, that nobody is signed in.
  await expect(header.getByText("Dana Unsaved")).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveURL(/\/en\/me$/);
  // This tab still shows her text. Typing on, waiting past the moment it would be written, and
  // then leaving the page must put nothing of hers back into the browser.
  await bio.fill("Dana reads aloud, to machines.");
  await page.waitForTimeout(900);
  expect(await unsavedKeys(other)).toEqual([]);
  await page.goto("/en/");
  await expect(page).toHaveURL(/\/en\/$/);
  expect(await unsavedKeys(page)).toEqual([]);
  await other.close();
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
  // The whole proposal is on the page, not only in the CSV files: the answers to the format's
  // own fields, when it was sent in, and how to reach its people.
  const proposal = page.locator("main");
  await expect(
    proposal.getByRole("heading", { name: "Abstract of each paper or talk (anonymized)" }),
  ).toBeVisible();
  await expect(proposal.getByRole("term").filter({ hasText: /^Submitted$/ })).toBeVisible();
  await expect(proposal.getByRole("term").filter({ hasText: /^Last changed$/ })).toBeVisible();
  await expect(proposal.getByText(/e2e-panel@example\.org/)).toBeVisible();
  // Under it, a chair finds who reviews it. This call is still open, so nobody can be
  // assigned yet, and the page says so (assigning is tried in settings.spec.ts).
  const reviewers = proposal.getByRole("region", { name: "Reviewers" });
  await expect(reviewers.getByText(/^Reviewers assigned: 0 of \d+\./)).toBeVisible();
  await expect(reviewers.getByText("No reviewer is assigned to this proposal.")).toBeVisible();
  await expect(
    reviewers.getByText(
      "No reviewer can be assigned yet: the call has not closed. Reviewers can be assigned once its closing date has passed, or once the conference is in review.",
    ),
  ).toBeVisible();
  // The proposal is for reading: nothing to type into, and while the call is open nothing to press.
  await expect(proposal.getByRole("textbox")).toHaveCount(0);
  await expect(proposal.getByRole("button")).toHaveCount(0);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
  const back = proposal.getByRole("link", { name: "Back to the submissions" });
  await expectTouchTarget(back);
  await back.click();
  await expect(page.getByRole("heading", { level: 1, name: "Manage submissions" })).toBeVisible();

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
  await expect(card("Panel on platforms").getByText(/^Panel · Enviada/)).toBeVisible();
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

  // A chair moves the phase from here, one step at a time, after a confirmation that says what
  // the phase does. Only the phase room is moved: an empty conference seeded in review for
  // this. Other tests depend on the phase of every other conference, the sandbox among them,
  // whose reviewers write their reviews beside this test (review.spec.ts), which they can only
  // while it is in review. The room is left "In review", as it was seeded.
  const ROOM = "phase-room";
  const PHASE = `/api/conferences/${ROOM}/phase`;
  const phaseNow = async () =>
    ((await (await page.request.get(`/api/conferences/${ROOM}`)).json()) as { phase: string })
      .phase;
  const sent: unknown[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && new URL(r.url()).pathname === PHASE) sent.push(r.postDataJSON());
  });
  await page.goto(`/en/c/${ROOM}/manage`);
  const phase = page.getByRole("region", { name: "Conference phase" });
  const shows = (name: string) =>
    expect(phase.getByText(`The conference is in the phase “${name}”.`)).toBeVisible();
  await shows("In review");
  const forward = phase.getByRole("button", { name: "Move to “Decisions in progress”" });
  const goBack = phase.getByRole("button", { name: "Go back to “Call for proposals open”" });
  await expectTouchTarget(forward);
  await expectTouchTarget(goBack);
  await expectAccessibleInBothThemes(page);
  await expectNoHorizontalScroll(page);

  // The button moves nothing. It asks, in its place, and says in a sentence what the phase does.
  const DECIDING =
    "The call is closed, and a submitted proposal can still be withdrawn. Reviews can no longer be written or changed: reviewers still read the proposals assigned to them and their own reviews. Chairs can record a decision on each proposal's page, and send the decisions from the Decisions page: sending tells the authors.";
  await forward.click();
  await expect(
    phase.getByRole("heading", { name: "Move the conference to “Decisions in progress”?" }),
  ).toBeFocused();
  await expect(phase.getByText(DECIDING)).toBeVisible();
  await expect(forward).toHaveCount(0);
  const yes = phase.getByRole("button", { name: "Yes, move it" });
  const cancel = phase.getByRole("button", { name: "Cancel" });
  // Someone who tabs straight to the button hears the sentence with it.
  await expect(yes).toHaveAccessibleDescription(DECIDING);
  await expectTouchTarget(yes);
  await expectTouchTarget(cancel);
  await expectAccessibleInBothThemes(page);
  await expectNoHorizontalScroll(page);
  await cancel.click();
  await expect(forward).toBeFocused();
  expect(sent).toEqual([]);
  expect(await phaseNow()).toBe("reviewing");

  // The move does not arrive: the page says so, and the confirmation stays to be tried again.
  const said = phase.getByRole("status");
  await page.route(`**${PHASE}`, (route) => route.abort());
  await forward.click();
  await yes.focus();
  await page.keyboard.press("Enter");
  await expect(said).toHaveText("The server did not confirm the move. Please try again.");
  await expect(yes).toBeFocused();
  await page.unroute(`**${PHASE}`);
  expect(await phaseNow()).toBe("reviewing");

  // Confirmed, the conference moves: the page says so there, and shows the phase as it is now.
  await page.keyboard.press("Enter");
  await expect(said).toHaveText("The conference is now in the phase “Decisions in progress”.");
  await expect(said).toBeFocused();
  await shows("Decisions in progress");
  await expect(
    phase.getByRole("button", { name: "Move to “Confirming participants”" }),
  ).toBeVisible();
  // The request names the phase the page showed, so the server moves only from it.
  expect(sent.at(-1)).toEqual({ phase: "deciding", from: "reviewing" });
  expect(await phaseNow()).toBe("deciding");

  // Going back asks for a reason, and is not sent without one that the server would take.
  const before = sent.length;
  await phase.getByRole("button", { name: "Go back to “In review”" }).click();
  await expect(
    phase.getByRole("heading", { name: "Take the conference back to “In review”?" }),
  ).toBeFocused();
  await expect(
    phase.getByText(
      "The call is closed whatever the dates say: nobody can start, edit or submit a proposal, or confirm an invitation, but a submitted proposal can still be withdrawn. Reviewers can open the proposals assigned to them, and are emailed about those already assigned, as often as each has chosen; they write, send and change their reviews in this phase. Chairs can record decisions, which tells nobody; decisions cannot be sent in this phase.",
    ),
  ).toBeVisible();
  const reason = phase.getByLabel("Reason for going back");
  const takeBack = phase.getByRole("button", { name: "Yes, take it back" });
  const NEEDED = "Write the reason in one line, with at least one letter or digit.";
  await expectTouchTarget(reason);
  await expectTouchTarget(takeBack);
  await expect(reason).toHaveAttribute("maxlength", "500");
  await takeBack.click();
  await expect(phase.getByText(NEEDED)).toBeVisible();
  await expect(reason).toBeFocused();
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await expect(reason).toHaveAccessibleDescription(new RegExp(`${NEEDED}$`));
  expect(sent).toHaveLength(before);
  await expectAccessibleInBothThemes(page);
  await expectNoHorizontalScroll(page);
  // Typing takes the message away; a reason with no letter or digit is the server's to refuse.
  await reason.fill("?!");
  await expect(phase.getByText(NEEDED)).toHaveCount(0);
  await takeBack.click();
  await expect(phase.getByText(NEEDED)).toBeVisible();
  await expect(reason).toBeFocused();
  expect(sent.at(-1)).toEqual({
    phase: "reviewing",
    from: "deciding",
    force: true,
    reason: "?!",
  });
  expect(await phaseNow()).toBe("deciding");
  // An invisible mark pasted along with the reason is not sent.
  await reason.fill(`${LRM}Moved by a browser test; back as it was `);
  await takeBack.click();
  await expect(said).toHaveText("The conference is now in the phase “In review”.");
  await expect(said).toBeFocused();
  await shows("In review");
  expect(sent.at(-1)).toEqual({
    phase: "reviewing",
    from: "deciding",
    force: true,
    reason: "Moved by a browser test; back as it was",
  });
  expect(await phaseNow()).toBe("reviewing");

  // Another chair moves the phase first (here, this chair's own session, behind the page): the
  // move asked for no longer applies, the page says so and shows the phase as it is now.
  const elsewhere = await page.request.put(PHASE, {
    headers: { origin: new URL(page.url()).origin },
    data: { phase: "deciding" },
  });
  expect(elsewhere.status()).toBe(200);
  await shows("In review");
  await forward.click();
  await yes.click();
  await expect(said).toHaveText(
    "The phase was not moved: it had already changed. It is shown here as it is now.",
  );
  await expect(said).toBeFocused();
  await shows("Decisions in progress");
  await expectAccessible(page);
  // And back, to leave the room as it was found.
  await phase.getByRole("button", { name: "Go back to “In review”" }).click();
  await reason.fill("Left as it was found");
  await takeBack.click();
  await expect(said).toHaveText("The conference is now in the phase “In review”.");
  await shows("In review");
  expect(await phaseNow()).toBe("reviewing");
});
