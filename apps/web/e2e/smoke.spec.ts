import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** The call that is always open: ELO 2027's own configuration on dates that follow the clock. */
const CALL = "elo2027-open";

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

type Texts = Record<string, string>;
/** What these tests read of a conference, so that they hold whatever its configuration says. */
type Conference = {
  phase: string;
  callOpen: boolean;
  callState: "open" | "upcoming" | "closed";
  config: {
    title: Texts;
    theme: Texts;
    host: string;
    location: Texts;
    website?: string;
    timezone: string;
    languages: string[];
    dates: { start: string; end: string };
    deadlines: Record<
      "submissionsOpen" | "submissionsClose" | "notification" | "finalMaterials",
      string
    >;
    distinction?: Texts;
    invitation?: Texts;
    contributionGroups: { key: string; name: Texts; summary: Texts; formats: string[] }[];
    submissionTypes: { key: string; name: Texts }[];
  };
};

const conference = async (page: Page, slug: string) =>
  (await (await page.request.get(`/api/conferences/${slug}`)).json()) as Conference;

/** A text the configuration must hold for the test to mean anything. */
function held(text: string | undefined, what: string): string {
  if (!text) throw new Error(`the call's configuration has no ${what}`);
  return text;
}

/**
 * A deadline's date and time as they were written: in the offset it is stored with, not turned
 * into the conference's time zone or the reader's.
 */
function asWritten(iso: string, lang: string): string {
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  const minutes = offset
    ? (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]))
    : 0;
  return new Intl.DateTimeFormat(lang, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(Date.parse(iso) + minutes * 60_000));
}

const inZone = (iso: string, lang: string, timeZone: string) =>
  new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    new Date(iso),
  );

const dateRange = (dates: { start: string; end: string }, lang: string) =>
  new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).formatRange(
    new Date(`${dates.start}T12:00:00Z`),
    new Date(`${dates.end}T12:00:00Z`),
  );

/** "English or Spanish": the conference's languages, named and joined in the page's language. */
function languageChoice(languages: string[], lang: string): string {
  const names = new Intl.DisplayNames([lang], { type: "language" });
  return new Intl.ListFormat(lang, { type: "disjunction" }).format(
    languages.map((code) => names.of(code) ?? code),
  );
}

/** The levels of the page's headings, in order: one h1 first, and no level skipped after it. */
async function expectHeadingOrder(page: Page) {
  const levels = await page
    .locator("h1, h2, h3, h4, h5, h6")
    .evaluateAll((all) => all.map((h) => Number(h.tagName.slice(1))));
  expect(levels[0]).toBe(1);
  expect(levels.filter((level) => level === 1)).toHaveLength(1);
  expect(levels[1]).toBe(2);
  levels.forEach((level, i) => {
    if (i > 0) expect(level - (levels[i - 1] ?? level)).toBeLessThanOrEqual(1);
  });
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

/** The latest sign-in email to an address, by its kind: other email may reach it meanwhile. */
async function latestMail(request: APIRequestContext, email: string) {
  return (await (
    await request.get(`/api/_test/outbox/latest?kind=magic_link&to=${email}`)
  ).json()) as {
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
  // Its formats are shown one at a time (formats.spec.ts reads them all): the talk, chosen in
  // the select, has its lengths and how it is reviewed in the one panel.
  const chooser = page.getByRole("combobox", { name: "Format", exact: true });
  const talk = await chooser
    .locator("option", { hasText: "Individual talk" })
    .getAttribute("value");
  await chooser.selectOption(talk ?? "");
  const panel = page.locator(".format-panel");
  await expect(panel).toHaveCount(1);
  await expect(panel.getByRole("heading", { level: 3, name: "Individual talk" })).toBeVisible();
  await expect(panel.getByText("250–300 words")).toBeVisible();
  await expect(
    panel.getByText("Anonymized review: reviewers do not see who you are."),
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
  const { config } = await conference(page, CALL);
  await page.goto("/en/");
  await page.getByRole("link", { name: "Español" }).click();
  await expect(page).toHaveURL(/\/es\/$/);
  // The front page is the invitation of the call that is open: its heading is the theme.
  await expect(
    page.getByRole("heading", { level: 1, name: held(config.theme.es, "theme in Spanish") }),
  ).toBeVisible();
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
  // Asked for on the sign-in page, the link names no page to go to: only its token.
  expect(link).toMatch(/\/en\/auth\/verify#token=[A-Za-z0-9_-]+$/);

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
  // Changed with spec 02, §1.11: the page used to link to the sign-in page. It now has the
  // sign-in form on it.
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.locator('main a[href$="/sign-in"]')).toHaveCount(0);
});

test("sign in by typing the code (for the installed app)", async ({ page, request, browser }) => {
  const email = "reviewer-1@example.org";
  await requestLink(page, email);
  const m = /\b(\d{4}) (\d{4})\b/.exec((await latestMail(request, email)).text);
  expect(m).toBeTruthy();
  await page.getByLabel("Code from the email").fill(`${m?.[1]} ${m?.[2]}`);
  await page.getByRole("button", { name: "Sign in with code" }).click();
  await expect(page).toHaveURL(/\/en\/me$/);
  await expect(page.getByText("sandbox: Reviewer")).toBeVisible();

  // Checked here because this test has a reviewer of the sandbox's scientific pool signed in, and
  // the suite is close to the server's limit on sign-in links: the chairs wrote no guidelines
  // for that pool, so its reviewer is shown none above a proposal. (review.spec.ts reads the
  // guidelines of the pool that has them.)
  const conference = (await (await page.request.get("/api/conferences/sandbox")).json()) as {
    config: {
      reviewPools: { key: string; guidelines?: Record<string, string> }[];
      submissionTypes: { key: string; reviewPool: string }[];
    };
  };
  const listed = await page.request.get("/api/conferences/sandbox/submissions?limit=100");
  const assigned = (
    (await listed.json()) as {
      items: { view: string; id: string; typeKey: string; title: string }[];
    }
  ).items.find((x) => x.view === "reviewer");
  expect(assigned, "a proposal assigned to this reviewer").toBeTruthy();
  if (!assigned) return;
  const pool = conference.config.submissionTypes.find((x) => x.key === assigned.typeKey);
  expect(
    conference.config.reviewPools.find((x) => x.key === pool?.reviewPool),
    "the pool that reviews it has no guidelines",
  ).not.toHaveProperty("guidelines");
  await page.goto(`/en/s/${assigned.id}`);
  await expect(page.getByRole("heading", { level: 1, name: assigned.title })).toBeVisible();
  await expect(
    page.getByText("You are reading this proposal as one of its reviewers."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Guidelines for reviewers" })).toHaveCount(0);
  await expect(page.locator(".guidelines")).toHaveCount(0);

  // Checked here because this test has someone signed in (spec 02, §1.11). The sign-in form is
  // for when the server says that nobody is signed in. A request that fails for another reason
  // is said as such, and never asks someone who is signed in to sign in.
  await page.route("**/api/me/submissions", (route) => route.abort());
  await page.goto("/en/my");
  await expect(page.getByRole("heading", { level: 1, name: "My submissions" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "We could not reach the server. Check your connection and try again.",
  );
  await expect(page.getByLabel("Email address")).toHaveCount(0);
  await page.unroute("**/api/me/submissions");
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 500, json: { error: "internal" } }),
  );
  for (const [path, heading] of [
    ["/en/me", "Your account"],
    [`/en/c/${CALL}/submit`, "Start a proposal"],
  ]) {
    await page.goto(path as string);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText("Something went wrong. Please try again.");
    await expect(page.getByLabel("Email address")).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
  }
  await page.unroute("**/api/me");

  // Checked here because this test knows a proposal that exists. To someone who is not signed
  // in, its page reads exactly as the page of a proposal that does not exist: it asks them to
  // sign in, and says nothing of either. The reviewer's own page of it has no such form.
  await page.goto(`/en/s/${assigned.id}`);
  await expect(page.getByRole("heading", { level: 1, name: assigned.title })).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveCount(0);
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "en-US",
  });
  const visitor = await context.newPage();
  const shown = async (path: string) => {
    await visitor.goto(path);
    await expect(visitor.getByLabel("Email address")).toBeVisible();
    await visitor.waitForLoadState("networkidle");
    return { title: await visitor.title(), page: await visitor.locator("main").innerHTML() };
  };
  const real = await shown(`/en/s/${assigned.id}`);
  expect(real.title).toBe("Proposal – ELOchair");
  expect(real.page).toContain("Sign in to read this proposal.");
  expect(real.page).not.toContain(assigned.title);
  expect(real.page).not.toMatch(/could not find|not assigned/);
  expect(await shown(`/en/s/${NO_PROPOSAL}`)).toEqual(real);
  expect(await shown("/en/s/not-an-id")).toEqual(real);
  const cannot = await shown(`/en/s/${assigned.id}/cannot-review`);
  expect(cannot.page).toContain("Sign in to tell the chairs that you cannot review this proposal.");
  expect(cannot.page).not.toMatch(/could not find|not assigned/);
  expect(await shown(`/en/s/${NO_PROPOSAL}/cannot-review`)).toEqual(cannot);
  // What the server answers the two pages has the same status and body for both proposals as
  // well; and what is no id at all is answered as an id nobody has.
  const answer = async (id: string, part: string) => {
    const res = await visitor.request.get(`/api/submissions/${id}${part}`);
    return [res.status(), await res.text()];
  };
  for (const part of ["", "/conference", "/review"]) {
    const real = await answer(assigned.id, part);
    expect(Number(real[0]), part).toBeGreaterThanOrEqual(400);
    expect(await answer(NO_PROPOSAL, part), part).toEqual(real);
    if (part !== "/review") expect(await answer("not-an-id", part), part).toEqual(real);
  }
  await context.close();
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

  // Checked here because this test has a track chair signed in, and the suite is close to the
  // server's limit on sign-in links: a track chair manages submissions, and is offered neither
  // the conference's settings nor its phase (those are the chairs'; see submission.spec.ts).
  await expect(page.getByText(/^sandbox: Track chair/)).toBeVisible();
  const me = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/me");
  await page.goto("/en/c/sandbox/manage");
  await expect(page.getByRole("heading", { level: 1, name: "Manage submissions" })).toBeVisible();
  await expect(page.getByText(/^Showing \d+ of \d+/)).toBeVisible();
  // Once the page knows who is looking, and has nothing more to load.
  await me;
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: "Download proposals (CSV)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Conference settings" })).toHaveCount(0);
  // Nor who holds a role, or who reviews what: those pages are the chairs' too.
  await expect(page.getByRole("link", { name: "People", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Assignments", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Conference phase" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Move to|Go back to) / })).toHaveCount(0);
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

/*
 * Signing in where you are (spec 02, §1.11). A page that needs someone signed in has the
 * sign-in form on it, and signing in brings the person to that page. These tests ask the server
 * for no sign-in email (it rations them, and the suite is close to the limit): the request is
 * answered in the page, as the server answers it. The whole way, by the emailed link and by
 * the typed code, is walked once each where a test signed in anyway (submission.spec.ts,
 * review.spec.ts, settings.spec.ts).
 */
/** A proposal's address that names no proposal. */
const NO_PROPOSAL = "3f2b8c1e-5d47-4a90-8b6e-0c9d1e2f3a4b";

test("a page that needs someone signed in has the sign-in form on it, and asks for a link that leads back to it", async ({
  page,
}) => {
  test.slow();
  const { config } = await conference(page, CALL);
  const format = held(config.submissionTypes[1]?.key, "second format");
  const chairs = "Sign in to open this page. It is for the chairs of this conference.";
  const pages: { path: string; heading: string; why: string }[] = [
    {
      path: `/en/c/${CALL}/submit?format=${format}`,
      heading: "Start a proposal",
      why: "Sign in to start a proposal.",
    },
    {
      path: "/en/my",
      heading: "My submissions",
      why: "Please sign in to see your proposals.",
    },
    { path: "/en/reviews", heading: "My reviews", why: "Please sign in to see your reviews." },
    { path: "/en/me", heading: "Your account", why: "Please sign in to see your account." },
    {
      path: `/en/s/${NO_PROPOSAL}`,
      heading: "Proposal",
      why: "Sign in to read this proposal. Proposals are shown only to the people on them, to their reviewers and to the chairs of their conference.",
    },
    {
      path: `/en/s/${NO_PROPOSAL}/cannot-review`,
      heading: "I cannot review this proposal",
      why: "Sign in to tell the chairs that you cannot review this proposal.",
    },
    { path: "/en/c/sandbox/manage", heading: "Manage submissions", why: chairs },
    { path: "/en/c/sandbox/settings", heading: "Conference settings", why: chairs },
    { path: "/en/c/sandbox/people", heading: "People", why: chairs },
    { path: "/en/c/sandbox/assignments", heading: "Assignments", why: chairs },
    { path: "/en/c/sandbox/decisions", heading: "Decisions", why: chairs },
    // A conference that does not exist reads as one that does: nobody is told which it is.
    { path: "/en/c/no-such-conference/settings", heading: "Conference settings", why: chairs },
  ];

  // Every request for a sign-in email is answered here, as the server answers: none reaches it.
  const asked: unknown[] = [];
  await page.route("**/api/auth/request-link", (route) => {
    asked.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { ok: true } });
  });
  const email = "visitor@example.org";
  const send = page.getByRole("button", { name: "Email me a link" });
  const comesBack = page.getByText("The link in the email brings you back to this page.");

  for (const { path, heading, why } of pages) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1, name: heading, exact: true }),
      path,
    ).toBeVisible();
    await expect(page.getByText(why, { exact: true }), path).toBeVisible();
    await expect(comesBack).toBeVisible();
    // The form is on the page: there is no link to another page to sign in on, and nothing
    // that reads as an error or as "not found".
    await expect(page.locator('main a[href$="/sign-in"]')).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/could not find|do not chair|Only the/);
    await expectAccessible(page);
    await page.getByLabel("Email address").fill(email);
    await send.click();
    await expect(page.getByText("Check your email.")).toBeVisible();
    // What it asked for: a link that leads to this very page, query and all.
    expect(asked.pop(), path).toEqual({ email, lang: "en", next: path });
    await expect(page.getByLabel("Code from the email")).toBeVisible();
  }

  // On a phone: nothing scrolls sideways, what is tapped is tall enough, and both themes pass.
  await expectTouchTarget(send);
  await expectTouchTarget(page.getByRole("button", { name: "Sign in with code" }));
  await expectAccessibleInBothThemes(page);
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 390, height: 844 });

  // In another language the page's own address is in that language, and so is the email.
  await page.goto("/es/my");
  await expect(page.getByText("Entra para ver tus propuestas.")).toBeVisible();
  await expect(page.getByText("Con el enlace del correo vuelves a esta página.")).toBeVisible();
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByRole("button", { name: "Enviarme un enlace" }).click();
  await expect(page.getByText("Revisa tu correo.")).toBeVisible();
  expect(asked.pop()).toEqual({ email, lang: "es", next: "/es/my" });
  await expectAccessible(page);
  await page.goto("/pt/reviews");
  await expect(page.getByText("Entre para ver as suas revisões.")).toBeVisible();
  await expect(page.getByText("Com o link do email volta a esta página.")).toBeVisible();
  await page.getByLabel("Endereço de email").fill(email);
  await page.getByRole("button", { name: "Enviar-me um link" }).click();
  await expect(page.getByText("Verifique o seu email.")).toBeVisible();
  expect(asked.pop()).toEqual({ email, lang: "pt", next: "/pt/reviews" });
  await expectAccessible(page);

  // A fragment is never part of it: only the page and its query are named.
  await page.goto("/en/my#token=abcdefghijklmnopqrstuvwxyz");
  await page.getByLabel("Email address").fill(email);
  await send.click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  expect(asked.pop()).toEqual({ email, lang: "en", next: "/en/my" });
  // An address written as the app never writes one is not sent, and nothing is promised.
  await page.goto("/en/my?from=a%20newsletter");
  await expect(page.getByText("Please sign in to see your proposals.")).toBeVisible();
  await expect(comesBack).toHaveCount(0);
  await page.getByLabel("Email address").fill(email);
  await send.click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  expect(asked.pop()).toEqual({ email, lang: "en" });

  // The sign-in page is for someone going nowhere in particular: it names no page, and its
  // link leads to "Your account", as it always did.
  await page.goto("/en/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(comesBack).toHaveCount(0);
  await page.getByLabel("Email address").fill(email);
  await send.click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  expect(asked.pop()).toEqual({ email, lang: "en" });
  expect(asked).toEqual([]);
});

test("whatever a sign-in link says about where to go, signing in leaves nobody outside the app", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const origin = new URL(baseURL as string).origin;
  // What the page a sign-in link opens asks the server is answered here, as for a link that
  // works: nothing reaches the server, and no sign-in email is asked for.
  await page.route("**/api/auth/link-info", (route) =>
    route.fulfill({ json: { email: "visitor@example.org" } }),
  );
  await page.route("**/api/auth/verify", (route) => route.fulfill({ json: { person: null } }));
  // Nothing may be asked of another site, and nothing may run.
  const elsewhere: string[] = [];
  await page.route(
    (url) => url.protocol.startsWith("http") && url.origin !== origin,
    (route) => {
      elsewhere.push(route.request().url());
      return route.abort();
    },
  );
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    dialog.dismiss();
  });

  const token = "t".repeat(43);
  /** Follow a link with this fragment, tap "Sign in", and say where that led. */
  const follow = async (fragment: string) => {
    await page.goto(`/en/auth/verify#${fragment}`);
    await expect(page.getByText("This link signs you in as visitor@example.org.")).toBeVisible();
    // The token and the address are taken out of the address bar at once.
    await expect(page).toHaveURL(`${origin}/en/auth/verify`);
    await page.getByRole("button", { name: "Sign in" }).click();
    // Wherever that leads, it is another page (the page a sign-in link opens is never named).
    // Where it leads nowhere, the address it stayed at is what the test then reports.
    await page
      .waitForURL((url) => !url.pathname.endsWith("/auth/verify"), { timeout: 5_000 })
      .catch(() => {});
    return page.url();
  };

  const hostile = [
    "//evil.example",
    "//evil.example/en/my",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example/en/my",
    "https:evil.example",
    "/en//evil.example",
    "/en/\\evil.example",
    "/%2Fevil.example",
    "%2F%2Fevil.example",
    "/en/%2F%2Fevil.example",
    "/en/%5Cevil.example",
    "/en/../../evil.example",
    "/en/@evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "/en/my#top",
    "/en/my\n",
    "/en/my\r\nBcc: someone@evil.example",
    "/en/my\u202E",
    "/en/my\u200B",
    `/en/${"a".repeat(300)}`,
    "/fr/my",
    "/api/auth/logout",
    "/en/sign-in",
    "/en/auth/verify",
    "evil.example",
  ];
  for (const next of hostile) {
    // As the server would write it, encoded; and as someone might write it by hand, bare.
    for (const written of [
      encodeURIComponent(next),
      next.replace(/[#&\r\n]/g, encodeURIComponent),
    ]) {
      const landed = await follow(`token=${token}&next=${written}`);
      // On "Your account", where a link that names no page leads, with nothing asked of
      // another site on the way.
      expect([landed, elsewhere], JSON.stringify(next)).toEqual([`${origin}/en/me`, []]);
    }
  }
  await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();

  // An address inside the app is where the person lands; a second one is not looked at.
  expect(await follow(`token=${token}&next=${encodeURIComponent("/es/reviews")}`)).toBe(
    `${origin}/es/reviews`,
  );
  expect(
    await follow(
      `token=${token}&next=${encodeURIComponent(`/en/c/${CALL}/submit?format=x`)}&next=${encodeURIComponent("//evil.example")}`,
    ),
  ).toBe(`${origin}/en/c/${CALL}/submit?format=x`);
  expect(
    await follow(`token=${token}&next=${encodeURIComponent("//evil.example")}&next=%2Fen%2Fmy`),
  ).toBe(`${origin}/en/me`);
  expect(await follow(`token=${token}`)).toBe(`${origin}/en/me`);

  // A link leads to the page it names only if it takes nobody else's place, which is asked of
  // the server at the tap. What the server says about who is signed in is answered here.
  const named = `token=${token}&next=${encodeURIComponent("/es/reviews")}`;
  const signedInAs = (email: string) =>
    page.route("**/api/me", (route) =>
      route.fulfill({
        json: {
          kind: "person",
          person: {
            id: NO_PROPOSAL,
            email,
            displayName: null,
            affiliation: null,
            country: null,
            languages: [],
            pronouns: null,
            orcid: null,
            bios: {},
          },
          siteAdmin: false,
          roles: [],
        },
      }),
    );
  // Another account is signed in: the page warns first, as it always did, and the link leads
  // to "Your account", which names the account.
  await signedInAs("someone-else@example.org");
  await page.goto(`/en/auth/verify#${named}`);
  await expect(
    page.getByText("You are currently signed in as someone-else@example.org."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/auth/verify"));
  expect(page.url()).toBe(`${origin}/en/me`);
  await page.unroute("**/api/me");
  // Nobody was signed in when the page opened, and someone else is by the time of the tap.
  await page.goto(`/en/auth/verify#${named}`);
  await expect(page.getByText("This link signs you in as visitor@example.org.")).toBeVisible();
  await expect(page.getByText(/You are currently signed in as/)).toHaveCount(0);
  await signedInAs("someone-else@example.org");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/auth/verify"));
  expect(page.url()).toBe(`${origin}/en/me`);
  await page.unroute("**/api/me");
  // The server does not say who is signed in (it fails, or something in between answers in
  // its place): the link does not lead to the page either.
  for (const noAnswer of [
    { status: 500, json: { error: "internal" } },
    {
      status: 200,
      contentType: "text/html",
      body: "<html><body>Sign in to this network</body></html>",
    },
  ]) {
    await page.goto(`/en/auth/verify#${named}`);
    await expect(page.getByText("This link signs you in as visitor@example.org.")).toBeVisible();
    await page.route("**/api/me", (route) => route.fulfill(noAnswer));
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.endsWith("/auth/verify"));
    expect(page.url()).toBe(`${origin}/en/me`);
    await page.unroute("**/api/me");
  }
  // The person the link is for is signed in already: it leads to the page it names.
  await signedInAs("visitor@example.org");
  await page.goto(`/en/auth/verify#${named}`);
  await expect(page.getByText("This link signs you in as visitor@example.org.")).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/auth/verify"));
  expect(page.url()).toBe(`${origin}/es/reviews`);
  await page.unroute("**/api/me");

  // A link that no longer works offers the page it names, where the sign-in form is, and the
  // sign-in page where what it names is no page of the app. Nothing else is ever a link here.
  await page.unroute("**/api/auth/link-info");
  await page.route("**/api/auth/link-info", (route) =>
    route.fulfill({ status: 400, json: { error: "invalid_or_expired" } }),
  );
  for (const [next, offered] of [
    ["/es/reviews", "/es/reviews"],
    ["//evil.example", "/en/sign-in"],
    ["/\\evil.example", "/en/sign-in"],
    ["https://evil.example/en/my", "/en/sign-in"],
    ["javascript:alert(1)", "/en/sign-in"],
    ["/en/%2F%2Fevil.example", "/en/sign-in"],
  ]) {
    await page.goto("/en/");
    await page.goto(`/en/auth/verify#token=${token}&next=${encodeURIComponent(next as string)}`);
    await expect(page.getByText("This link has expired or has already been used.")).toBeVisible();
    await expect(page.locator("main a")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Request a new link" }), next).toHaveAttribute(
      "href",
      offered as string,
    );
  }

  expect(elsewhere).toEqual([]);
  expect(dialogs).toEqual([]);
});

test("an unknown conference says so, in the heading and the title", async ({ page }) => {
  await page.goto("/en/c/no-such-conference");
  await expect(
    page.getByRole("heading", { level: 1, name: "We could not find that conference." }),
  ).toBeVisible();
  await expect(page).toHaveTitle("We could not find that conference. – ELOchair");
});

/*
 * The invitation (spec 02, §1.10): the front page for the conference whose call is open, and
 * the top of that conference's own page. It is public, so nobody signs in here. The tests read
 * the call's configuration and hold the pages to it, whatever it says.
 *
 * The seeded call is open on any day, and that is the state these tests see. The other two
 * ("Call opening soon", "Submissions closed") cannot be reached without moving a conference's
 * dates or phase under the tests that run beside these: which state a call is in is decided by
 * one function, callState, and what each state shows by mainAction and chipKey, each with unit
 * tests of its own.
 */
test("the front page is the invitation to the open call, part by part, from its configuration", async ({
  page,
}) => {
  const { config, callState } = await conference(page, CALL);
  expect(callState).toBe("open");
  const groups = config.contributionGroups;
  expect(groups.length).toBeGreaterThan(0);

  await page.goto("/en/");
  const hero = page.locator(".hero");

  // 1. Which conference it is, and where its call stands.
  const eyebrow = hero.locator(".hero-eyebrow");
  await expect(eyebrow).toContainText(`${config.title.en} · Call for proposals`);
  await expect(eyebrow.locator(".echo")).toHaveText("Convocatoria de propuestas");

  // 2. The theme is the page's heading, and its echo is the theme in the other language.
  const theme = held(config.theme.en, "theme");
  await expect(page.getByRole("heading", { level: 1, name: theme, exact: true })).toBeVisible();
  await expect(page).toHaveTitle(`${config.title.en}: ${theme} – ELOchair`);
  const themeEcho = hero.locator(".hero-echo .echo");
  await expect(themeEcho).toHaveText(held(config.theme.es, "theme in Spanish"));
  await expect(themeEcho).toHaveAttribute("lang", "es");
  await expect(themeEcho).toHaveAttribute("aria-hidden", "true");

  // 3. The main action: the call is open, so it starts a proposal.
  const start = hero.getByRole("link", { name: "Start a proposal", exact: true });
  await expect(start).toHaveAttribute("href", `/en/c/${CALL}/submit`);
  await expect(start.locator(".echo")).toHaveText("Iniciar propuesta");
  await expectTouchTarget(start);
  await expect(
    hero.getByRole("link", { name: /Prepare a proposal|View my proposals/ }),
  ).toHaveCount(0);

  // 4. When and where, and 5. what sets this edition apart.
  const event = hero.locator(".invitation-event");
  await expect(event).toContainText(dateRange(config.dates, "en"));
  await expect(event).toContainText(dateRange(config.dates, "es"));
  await expect(event).toContainText(held(config.location.en, "place"));
  await expect(event).toContainText(config.host);
  await expect(event).toContainText(held(config.distinction?.en, "line about the edition"));
  await expect(event).toContainText(held(config.distinction?.es, "line about it in Spanish"));

  // 6. The invitation, and under it its echo. (The settings tests add to the end of the
  //    Spanish one while they run, so it is read by its beginning.)
  const invitation = hero.locator(".invitation-text");
  await expect(invitation).toContainText(held(config.invitation?.en, "invitation"));
  const invitationEcho = invitation.locator(".echo");
  await expect(invitationEcho).toContainText(
    held(config.invitation?.es, "invitation in Spanish").slice(0, 60),
  );
  await expect(invitationEcho).toHaveAttribute("lang", "es");
  await expect(invitationEcho).toHaveAttribute("aria-hidden", "true");

  // 7. The full call, on the conference's own site.
  const website = held(config.website, "website");
  const cfp = hero.getByRole("link", { name: "Read the CFP", exact: true });
  await expect(cfp).toHaveAttribute("href", website);
  await expect(cfp.locator(".echo")).toHaveText("Leer la convocatoria");
  await expectTouchTarget(cfp);

  // 8. When proposals are due, as the call states it. The closing date is written anywhere on
  //    Earth, and that is what the page says: not the hour it then is in the conference's city.
  const close = config.deadlines.submissionsClose;
  expect(close).toMatch(/-12:00$/);
  const due = hero.locator(".invitation-due");
  await expect(due).toContainText("Proposals due");
  const dueLink = due.getByRole("link");
  await expect(dueLink.locator(".pair-text")).toHaveText(`${asWritten(close, "en")} AoE`);
  await expect(dueLink.locator(".echo")).toHaveText(`${asWritten(close, "es")} AoE`);
  await expect(dueLink).toHaveAttribute("href", `/en/c/${CALL}#deadlines`);
  await expect(due).not.toContainText(inZone(close, "en", config.timezone));
  await expectTouchTarget(dueLink);
  // The front page has the days left no more than the design does: the call's own page has them.
  await expect(hero.locator(".countdown")).toHaveCount(0);

  // 9. Ways to contribute: the languages proposals may be in, then each group of formats with
  //    the way to them on the conference's page.
  await expect(
    page.getByRole("heading", { level: 2, name: "Ways to contribute", exact: true }),
  ).toBeVisible();
  const ways = page.getByRole("region", { name: "Ways to contribute" });
  await expect(ways.locator("h2 .echo")).toHaveText("Formas de participar");
  await expect(ways).toContainText(`Proposals in ${languageChoice(config.languages, "en")}.`);
  await expect(ways).toContainText(`Propuestas en ${languageChoice(config.languages, "es")}.`);
  const cards = ways.getByRole("listitem");
  await expect(cards).toHaveCount(groups.length);
  for (const [i, group] of groups.entries()) {
    const card = cards.nth(i);
    const name = held(group.name.en, "name of a way to contribute");
    const heading = card.getByRole("heading", { level: 3, name, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading.locator(".echo")).toHaveText(held(group.name.es, "its name in Spanish"));
    await expect(card).toContainText(held(group.summary.en, "line of a way to contribute"));
    await expect(card).toContainText(held(group.summary.es, "its line in Spanish"));
    // One format: the link says what it asks for. Several: it says there are formats to see.
    const label = group.formats.length === 1 ? "See requirements" : "Explore the formats";
    const link = card.getByRole("link", { name: `${label} (${name})`, exact: true });
    await expect(link).toHaveAttribute("href", `/en/c/${CALL}#format-${group.formats[0]}`);
    await expectTouchTarget(link);
  }

  // 10. Already involved? The ways back in. Everyone signs in the same way.
  const involved = page.getByRole("navigation", { name: "Already involved?" });
  await expect(involved.locator(".eyebrow .echo")).toHaveText("¿Ya participas?");
  const mine = involved.getByRole("link", { name: "Continue a proposal", exact: true });
  await expect(mine).toHaveAttribute("href", "/en/my");
  await expectTouchTarget(mine);
  for (const name of ["Reviewer sign-in", "Organizer sign-in"]) {
    const link = involved.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", "/en/sign-in");
    await expectTouchTarget(link);
  }
  await expect(involved).toContainText(
    "Reviewers and organizers sign in with the email address from their invitation.",
  );

  // 11. The conference's own website, in the footer.
  const site = page
    .locator(".site-footer")
    .getByRole("link", { name: "Conference website", exact: true });
  await expect(site).toHaveAttribute("href", website);
  await expect(site.locator(".echo")).toHaveText("Sitio del congreso");
  await expectTouchTarget(site);

  // After the invitation, the other conferences; the one it features is not among them.
  await expect(page.getByRole("heading", { level: 2, name: "Other conferences" })).toBeVisible();
  await expect(page.locator("li.card").getByRole("link", { name: config.title.en })).toHaveCount(0);
  await expectHeadingOrder(page);
  await expectAccessibleInBothThemes(page);
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);
});

test("in Spanish the invitation turns round: Spanish first, English as its echo", async ({
  page,
}) => {
  const { config } = await conference(page, CALL);
  const group = config.contributionGroups[0];
  if (!group) throw new Error("the call's configuration has no way to contribute");

  await page.goto("/es/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  const hero = page.locator(".hero");
  const english = (echo: Locator, text: string) =>
    Promise.all([
      expect(echo).toHaveText(text),
      expect(echo).toHaveAttribute("lang", "en"),
      expect(echo).toHaveAttribute("aria-hidden", "true"),
    ]);

  const eyebrow = hero.locator(".hero-eyebrow");
  await expect(eyebrow).toContainText(`${config.title.es} · Convocatoria de propuestas`);
  await english(eyebrow.locator(".echo"), "Call for proposals");
  const theme = held(config.theme.es, "theme in Spanish");
  await expect(page.getByRole("heading", { level: 1, name: theme, exact: true })).toBeVisible();
  await english(hero.locator(".hero-echo .echo"), held(config.theme.en, "theme"));

  const start = hero.getByRole("link", { name: "Iniciar propuesta", exact: true });
  await expect(start).toHaveAttribute("href", `/es/c/${CALL}/submit`);
  await english(start.locator(".echo"), "Start a proposal");

  const event = hero.locator(".invitation-event");
  await expect(event).toContainText(dateRange(config.dates, "es"));
  await english(event.locator(".echo").first(), dateRange(config.dates, "en"));
  await expect(event).toContainText(held(config.distinction?.es, "line about the edition"));
  await english(event.locator(".echo").last(), held(config.distinction?.en, "line in English"));

  // The Spanish invitation leads (read by its beginning: see the test above), and the English
  // one is its echo, whole.
  const invitation = hero.locator(".invitation-text");
  await expect(invitation).toContainText(
    held(config.invitation?.es, "invitation in Spanish").slice(0, 60),
  );
  await english(invitation.locator(".echo"), held(config.invitation?.en, "invitation"));

  const cfp = hero.getByRole("link", { name: "Leer la convocatoria", exact: true });
  await english(cfp.locator(".echo"), "Read the CFP");
  const close = config.deadlines.submissionsClose;
  const due = hero.locator(".invitation-due");
  await expect(due).toContainText("Fecha límite");
  await expect(due.locator(".pair-text")).toHaveText(`${asWritten(close, "es")} AoE`);
  await english(due.locator(".fact .echo"), `${asWritten(close, "en")} AoE`);

  await expect(
    page.getByRole("heading", { level: 2, name: "Formas de participar", exact: true }),
  ).toBeVisible();
  const ways = page.getByRole("region", { name: "Formas de participar" });
  await english(ways.locator("h2 .echo"), "Ways to contribute");
  await expect(ways).toContainText(`Propuestas en ${languageChoice(config.languages, "es")}.`);
  await expect(ways).toContainText(`Proposals in ${languageChoice(config.languages, "en")}.`);
  const card = ways.getByRole("listitem").first();
  const name = held(group.name.es, "name of a way to contribute in Spanish");
  const heading = card.getByRole("heading", { level: 3, name, exact: true });
  await english(heading.locator(".echo"), held(group.name.en, "its name"));
  await expect(card).toContainText(held(group.summary.es, "its line in Spanish"));
  const label = group.formats.length === 1 ? "Ver requisitos" : "Explorar los formatos";
  await expect(card.getByRole("link", { name: `${label} (${name})`, exact: true })).toHaveAttribute(
    "href",
    `/es/c/${CALL}#format-${group.formats[0]}`,
  );

  const involved = page.getByRole("navigation", { name: "¿Ya participas?" });
  await expect(
    involved.getByRole("link", { name: "Continuar una propuesta", exact: true }),
  ).toHaveAttribute("href", "/es/my");
  for (const link of ["Acceso de revisores", "Acceso de organización"]) {
    await expect(involved.getByRole("link", { name: link, exact: true })).toHaveAttribute(
      "href",
      "/es/sign-in",
    );
  }
  await expect(
    page.locator(".site-footer").getByRole("link", { name: "Sitio del congreso", exact: true }),
  ).toHaveAttribute("href", held(config.website, "website"));
  await expectHeadingOrder(page);
  await expectAccessibleInBothThemes(page);
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);

  // In Portuguese, the app's third language, the page's own texts lead in the same way.
  await page.goto("/pt/");
  await expect(
    page.getByRole("heading", { level: 1, name: held(config.theme.pt, "theme in Portuguese") }),
  ).toBeVisible();
  await expect(
    page.locator(".hero").getByRole("link", { name: "Iniciar proposta", exact: true }),
  ).toHaveAttribute("href", `/pt/c/${CALL}/submit`);
  await expect(page.locator(".invitation-due")).toContainText("Data limite");
  await expect(
    page.getByRole("heading", { level: 2, name: "Formas de participar", exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("the invitation's links lead to the part of the conference's page they name", async ({
  page,
}) => {
  const { config } = await conference(page, CALL);
  const [first, last] = [config.contributionGroups[0], config.contributionGroups.at(-1)];
  if (!first || !last) throw new Error("the call's configuration has no way to contribute");
  const wayTo = (group: typeof first) =>
    page
      .getByRole("region", { name: "Ways to contribute" })
      .getByRole("link", { name: `(${held(group.name.en, "name")})` });
  const theme = page.getByRole("heading", { level: 1, name: held(config.theme.en, "theme") });

  // From the front page, a way to contribute goes to its first format on the conference's page.
  // That page shows one format at a time: this one is chosen, and its name, the heading of the
  // one panel, is in view and has the focus, so that reading and the keyboard go on from it.
  await page.goto("/en/");
  await wayTo(last).click();
  await expect(page).toHaveURL(new RegExp(`/en/c/${CALL}#format-${last.formats[0]}$`));
  const shown = page.locator(`#format-${last.formats[0]}`);
  await expect(shown).toBeFocused();
  await expect(shown).toBeInViewport();
  const format = config.submissionTypes.find((type) => type.key === last.formats[0]);
  await expect(shown).toContainText(held(format?.name.en, "format of that key"));
  await expect(page.locator(".format-panel").getByRole("heading", { level: 3 })).toHaveCount(1);
  await expect(page.locator(".format-panel").locator(shown)).toHaveCount(1);

  // The conference's page begins with the same invitation, and there the same links stay on
  // the page: the address changes only after the "#", and the page's heading stays out of it
  // (it takes the focus when a page is new, which this is not).
  await expect(theme).toBeVisible();
  await page.evaluate(() => {
    const heard: string[] = [];
    document.addEventListener("focusin", (event) => heard.push((event.target as Element).tagName));
    Object.assign(window, { heard });
  });
  await wayTo(first).click();
  await expect(page).toHaveURL(new RegExp(`/en/c/${CALL}#format-${first.formats[0]}$`));
  await expect(page.locator(`#format-${first.formats[0]}`)).toBeFocused();
  await expect(page.locator(`#format-${first.formats[0]}`)).toBeInViewport();
  const heard = await page.evaluate(() => (window as unknown as { heard: string[] }).heard);
  expect(heard.at(-1)).toBe("H3");
  expect(heard).not.toContain("H1");

  // The due date leads to the deadlines. There the closing date is stated as the call states
  // it, anywhere on Earth, and then on this visitor's own clock; the dates that are written in
  // the conference's own offset are in conference time, as they always were.
  await page.goto("/en/");
  await page.locator(".invitation-due").getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/en/c/${CALL}#deadlines$`));
  const deadlines = page.getByRole("heading", { level: 2, name: "Deadlines", exact: true });
  await expect(deadlines).toBeFocused();
  await expect(deadlines).toBeInViewport();
  const close = config.deadlines.submissionsClose;
  const closing = page.locator(".timeline > li").filter({ hasText: "Submissions close" });
  await expect(closing.locator(".when")).toHaveText(asWritten(close, "en"));
  await expect(closing).toContainText("Anywhere on Earth (AoE)");
  await expect(closing).toContainText(inZone(close, "en", "Europe/Lisbon"));
  await expect(closing).toContainText("Your time (Europe/Lisbon)");
  await expect(closing).not.toContainText("Conference time");
  await expect(closing).not.toContainText(inZone(close, "en", config.timezone));
  const opening = page.locator(".timeline > li").filter({ hasText: "Submissions open" });
  await expect(opening.locator(".when")).toHaveText(
    inZone(config.deadlines.submissionsOpen, "en", config.timezone),
  );
  await expect(opening).toContainText(`Conference time (${config.timezone})`);

  // Going to another page still lands on its heading: here, back to the front page.
  await page.getByRole("link", { name: "ELOchair", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(theme).toBeFocused();
});

test("a conference without an invitation is shown as before: in the list, on its own page, and when it is the one featured", async ({
  page,
}) => {
  // ELO 2026's configuration holds none of the three things an invitation is made of.
  const elo2026 = await conference(page, "elo2026");
  const title = held(elo2026.config.title.en, "title");
  expect(elo2026.config).not.toHaveProperty("invitation");
  expect(elo2026.config).not.toHaveProperty("distinction");
  expect(elo2026.config.contributionGroups).toEqual([]);

  // In the front page's list it is a compact card, and its chip names its phase.
  await page.goto("/en/");
  const listed = page.locator("li.card").filter({ has: page.getByRole("link", { name: title }) });
  await expect(listed.getByRole("heading", { level: 3 })).toHaveText(title);
  await expect(listed).toContainText(held(elo2026.config.location.en, "place"));
  await expect(listed).toContainText(dateRange(elo2026.config.dates, "en"));
  await expect(listed.locator(".badge")).toHaveText("Archived");
  await expectTouchTarget(listed.getByRole("link", { name: title }));

  // Its own page begins with its title, as it did, and has none of an invitation's parts.
  // (The first test in this file reads the rest of that page.)
  await page.goto("/en/c/elo2026");
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.locator(".hero-eyebrow")).toHaveText(
    "Electronic Literature Organization Conference",
  );
  await expect(page.locator(".invitation")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Ways to contribute" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Already involved?" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Start a proposal|View my proposals|Read the CFP/ }),
  ).toHaveCount(0);
  await expect(page.locator(".site-footer").getByRole("link")).toHaveCount(1);
  await expect(page.locator(".section-number")).toHaveText(["01", "02", "03", "04"]);
  // Its deadlines are written in its own time zone's offset: they read as they did, and name it.
  const close = elo2026.config.deadlines.submissionsClose;
  const tz = elo2026.config.timezone;
  await expect(page.locator(".hero-facts .fact").nth(2)).toHaveText(inZone(close, "en", tz));
  await expect(page.locator(".hero-facts .fact-sub").nth(2)).toHaveText(tz);
  await expect(page.locator(".timeline").getByText(`Conference time (${tz})`)).toHaveCount(4);
  await expect(page.locator(".timeline")).not.toContainText("AoE");
  await expect(page.locator(".hero .status-line")).toHaveText("Submissions are closed.");

  // Were it the only conference, the front page would feature it as before: a card under the
  // page's own heading, in the plain look. (The list is narrowed to it here; what it says of
  // ELO 2026 is the server's own.)
  const all = (await (await page.request.get("/api/conferences")).json()) as {
    conferences: { slug: string }[];
  };
  const only = all.conferences.filter((k) => k.slug === "elo2026");
  expect(only).toHaveLength(1);
  await page.route("**/api/conferences", (route) => route.fulfill({ json: { conferences: only } }));
  await page.goto("/en/");
  await expect(page.getByRole("heading", { level: 1, name: "Conferences" })).toBeVisible();
  await expect(page).toHaveTitle("Conferences – ELOchair");
  const feature = page.locator(".feature");
  await expect(feature.getByRole("heading", { level: 2 })).toHaveText(title);
  await expect(feature.locator(".badge")).toHaveText("Archived");
  await expect(feature.getByRole("link", { name: "See the call" })).toHaveAttribute(
    "href",
    "/en/c/elo2026",
  );
  await expect(feature.getByRole("link", { name: "Submit a proposal" })).toHaveCount(0);
  await expect(page.locator(".invitation")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Already involved?" })).toHaveCount(0);
  await expect(page.locator("[data-dressed]")).toHaveCount(0);
  await expectHeadingOrder(page);
  await expectAccessibleInBothThemes(page);
  await expectNoHorizontalScroll(page);

  // And with no conference at all, the page says so under the same heading.
  await page.unroute("**/api/conferences");
  await page.route("**/api/conferences", (route) => route.fulfill({ json: { conferences: [] } }));
  await page.goto("/en/");
  await expect(page.getByRole("heading", { level: 1, name: "Conferences" })).toBeVisible();
  await expect(page.getByText("No conferences are listed yet.")).toBeVisible();
});
