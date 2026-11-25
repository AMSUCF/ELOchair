import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

/*
 * The ELO 2027 identity (docs/design/visual-identity.md): what it shows, and the promises it
 * keeps while showing it: contrast on the band, touch targets, no motion when asked, nothing
 * fetched from elsewhere.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const CALL = "elo2027-open";
type Texts = Record<string, string>;

/** axe in the paper theme and again in the forest theme. */
async function expectAccessible(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      results.violations.map((v) => `${colorScheme}: ${v.id}: ${v.help} (${v.nodes.length})`),
    ).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** House rule 8: anything people tap is at least 44px tall. */
async function expectTouchTarget(target: Locator, minWidth = 0) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(minWidth);
}

test("the call's page shows the conference: theme and echo, place, deadline, formats, dates", async ({
  page,
}) => {
  await page.goto(`/en/c/${CALL}`);
  const hero = page.locator(".hero");
  // The page begins with the call's invitation: the theme is its heading, and the line above
  // names the conference and says where its call stands.
  await expect(hero.getByRole("heading", { level: 1 })).toHaveText("Ecologies of Attention");
  await expect(page).toHaveTitle("ELO 2027 (open test call): Ecologies of Attention – ELOchair");
  await expect(hero.locator(".hero-eyebrow")).toContainText(
    "ELO 2027 (open test call) · Call for proposals",
  );
  await expect(hero.getByText("10.96° N 74.80° W")).toBeVisible();
  await expect(hero.getByText("Universidad del Norte")).toBeVisible();
  // The echo is the theme in the conference's other language: shown, but not read out twice.
  const echo = hero.locator(".hero-echo .echo");
  await expect(echo).toHaveText("Ecologías de la atención");
  await expect(echo).toHaveAttribute("lang", "es");
  await expect(echo).toHaveAttribute("aria-hidden", "true");
  // The countdown shows only because the server says the call is open.
  await expect(hero.locator(".countdown")).toHaveText(/^\d+ days? left$/i);
  await expect(hero.getByRole("link", { name: "Start a proposal" })).toBeVisible();

  // One link to the full call, the invitation's; and the conference's site again in the footer.
  await expect(page.getByRole("link", { name: "Read the CFP" })).toHaveAttribute(
    "href",
    "https://elo27.eliterature.org/",
  );
  await expect(page.getByRole("link", { name: /Read the full call/ })).toHaveCount(0);
  await expect(
    page.locator(".site-footer").getByRole("link", { name: "Conference website" }),
  ).toHaveAttribute("href", "https://elo27.eliterature.org/");
  // The ways to contribute come first, so the sections that follow are numbered after them.
  await expect(page.locator(".section-number")).toHaveText(["01", "02", "03"]);
  await expect(page.getByRole("navigation", { name: "Already involved?" })).toBeVisible();
  // Section headings are named in the page's language only; the echo is decoration.
  await expect(
    page.getByRole("heading", { level: 2, name: "Submission formats", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#formats .echo")).toHaveText("Formatos de envío");
  // The call's formats, one at a time (formats.spec.ts reads the panel through, from the
  // call's configuration): the chooser has every format of the call in its order, those
  // submitted here and then those that are not, and the panel shows the first.
  const { config } = (await (await page.request.get(`/api/conferences/${CALL}`)).json()) as {
    config: Record<"submissionTypes" | "otherFormats", { key: string; name: Texts }[]>;
  };
  const listed = [...config.submissionTypes, ...config.otherFormats];
  expect(listed.length).toBeGreaterThan(1);
  const chooser = page.getByRole("combobox", { name: "Format", exact: true });
  await expect(chooser.locator("option")).toHaveText(
    listed.map((format, i) => `${String(i + 1).padStart(2, "0")} · ${format.name.en}`),
  );
  const panel = page.locator(".format-panel");
  await expect(panel).toHaveCount(1);
  const name = panel.getByRole("heading", { level: 3 });
  await expect(name).toHaveAccessibleName(listed[0]?.name.en ?? "");
  // The name's echo is shown and not read out, like every echo; the name is set in the
  // display face, heavy, and the figures in the colour of numerals.
  const nameEcho = name.locator(".echo");
  await expect(nameEcho).toHaveText(listed[0]?.name.es ?? "");
  await expect(nameEcho).toHaveAttribute("lang", "es");
  await expect(nameEcho).toHaveAttribute("aria-hidden", "true");
  expect(
    await name.evaluate((el) => {
      const style = getComputedStyle(el);
      return `${style.fontFamily.split(",")[0]?.replaceAll('"', "").trim()} ${style.fontWeight}`;
    }),
  ).toBe("Bricolage Grotesque Variable 700");
  expect(
    await panel
      .locator(".stat-value")
      .first()
      .evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--numeral)";
        el.append(probe);
        const same = getComputedStyle(probe).color === getComputedStyle(el).color;
        probe.remove();
        return same;
      }),
  ).toBe(true);
  // A format the call takes outside this portal says so, in the chooser's last place.
  if (config.otherFormats.length > 0) {
    await chooser.selectOption(listed.at(-1)?.key ?? "");
    await expect(panel.locator(".format-elsewhere")).toHaveText("Not submitted here");
    await chooser.selectOption(listed[0]?.key ?? "");
  }
  await expect(page.locator(".timeline > li")).toHaveCount(5);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);
  // Everything people tap in the formats is a touch target, on a small phone too.
  for (const control of await page
    .locator(".formats-view")
    .locator("a:visible, button:visible, select:visible")
    .all()) {
    await expectTouchTarget(control);
  }

  // In Spanish the pair turns round: Spanish first, English as the echo.
  await page.goto(`/es/c/${CALL}`);
  await expect(page.locator(".hero").getByText("Ecologías de la atención")).toBeVisible();
  await expect(page.locator(".hero-echo .echo")).toHaveText("Ecologies of Attention");
  await expect(page.locator(".countdown")).toHaveText(/^\d+ días? restantes?$/i);
  await expect(
    page.getByRole("heading", { level: 2, name: "Formatos de envío", exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("the front page wears the identity of the call it invites to, once, above the other conferences", async ({
  page,
}) => {
  await page.goto("/en/");
  const hero = page.locator(".hero");
  const heading = hero.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Ecologies of Attention");
  // Its address names no conference: the page says itself whose identity it wears.
  await expect(page.locator(".home")).toHaveAttribute("data-dressed", "elo2027");
  await expect(page.locator(".shell")).toHaveClass(/shell-hero/);

  // The band is the forest, and the headline is set as on the conference's site: the first
  // word heavy, the rest light and in the accent colour; the echo in the serif italic.
  const look = (target: Locator) =>
    target.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        family: style.fontFamily.split(",")[0]?.replaceAll('"', "").trim(),
        weight: style.fontWeight,
        italic: style.fontStyle === "italic",
        colour: style.color,
      };
    });
  const tokens = await page.locator(".shell").evaluate((shell) => {
    const style = getComputedStyle(shell);
    const probe = document.createElement("span");
    shell.append(probe);
    const rgb = (name: string) => {
      probe.style.color = style.getPropertyValue(name).trim();
      return getComputedStyle(probe).color;
    };
    const out = {
      band: getComputedStyle(shell).backgroundColor,
      forest: rgb("--forest"),
      text: rgb("--band-text"),
      accent: rgb("--band-accent"),
      echo: rgb("--band-echo"),
    };
    probe.remove();
    return out;
  });
  expect(tokens.band).toBe(tokens.forest);
  expect(await look(heading.locator(".headline-lead"))).toEqual({
    family: "Bricolage Grotesque Variable",
    weight: "700",
    italic: false,
    colour: tokens.text,
  });
  expect(await look(heading.locator(".headline-rest"))).toEqual({
    family: "Bricolage Grotesque Variable",
    weight: "300",
    italic: false,
    colour: tokens.accent,
  });
  expect(await look(hero.locator(".hero-echo .echo"))).toEqual({
    family: "Brygada 1918 Variable",
    weight: "400",
    italic: true,
    colour: tokens.echo,
  });
  expect(await look(hero.locator(".hero-eyebrow"))).toMatchObject({
    family: "Unbounded",
    colour: tokens.accent,
  });
  expect(await look(hero.locator(".invitation-text"))).toMatchObject({
    family: "Schibsted Grotesk Variable",
    colour: tokens.text,
  });
  // An echo under its text is in the echo colour; on the filled button it takes the button's.
  expect((await look(hero.locator(".invitation-text .echo"))).colour).toBe(tokens.echo);
  const start = hero.getByRole("link", { name: "Start a proposal" });
  expect((await look(start.locator(".echo"))).colour).toBe((await look(start)).colour);

  // Everything people tap in the invitation is a touch target.
  for (const link of await page
    .locator(".invitation a, .ways a, .involved a, .footer-slot a")
    .all()) {
    await expectTouchTarget(link);
  }

  // Featured, so not listed again.
  await expect(page.getByRole("heading", { level: 2, name: "Other conferences" })).toBeVisible();
  await expect(page.locator(".cards").getByRole("link", { name: /open test call/ })).toHaveCount(0);
  await expect(
    page.locator(".cards").getByRole("link", { name: "ELO 2026: (un)supervised" }),
  ).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);
  await expectTouchTarget(start);

  // In Spanish and in the forest theme the same holds.
  await page.goto("/es/");
  await expect(page.locator(".hero h1")).toHaveText("Ecologías de la atención");
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("the header fits a small phone, and everything in it is a touch target", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/en/my");
  const header = page.locator(".site-header");
  await expectTouchTarget(header.getByRole("link", { name: "ELOchair", exact: true }));
  // Nobody is signed in: "Sign in" is where a name would be, and there are no pages of one's
  // own for a menu to lead to.
  const signIn = header.getByRole("link", { name: "Sign in" });
  await expectTouchTarget(signIn, 44);
  await expect(header.getByRole("navigation", { name: "Main menu" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "My submissions" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Your account" })).toHaveCount(0);

  const languages = page.getByRole("navigation", { name: "Language" });
  for (const [code, name] of [
    ["EN", "English"],
    ["ES", "Español"],
    ["PT", "Português"],
  ] as const) {
    // The code is what shows; the accessible name has it, then the language's own name.
    const link = languages.getByRole("link", { name: `${code} ${name}`, exact: true });
    await expectTouchTarget(link, 44);
  }
  await expect(languages.getByRole("link", { name: "English" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expectNoHorizontalScroll(page);
  await expectTouchTarget(page.locator(".site-footer").getByRole("link").first());

  // "Sign in" leads to the sign-in page. The page you are on is marked for assistive
  // technology, not only by colour.
  await expect(signIn).not.toHaveAttribute("aria-current", "page");
  await signIn.click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(signIn).toHaveAttribute("aria-current", "page");
});

test("the header names whoever is signed in at its right end, offers only their pages that have something on them, and nothing moves when it learns who", async ({
  page,
}) => {
  // What the frame is told about whoever is looking is made up here, so that nobody has to
  // sign in for it: the server's own answers are in submissions.test.ts, and the tests that
  // do sign in (submission.spec.ts) see the real header.
  const NAME = "Maria Aparecida de Vasconcelos e Albuquerque";
  let told = { view: "menu", account: { name: NAME, email: "made-up@example.org" } } as object;
  let say: () => void = () => {};
  const said = new Promise<void>((resolve) => {
    say = resolve;
  });
  await page.route("**/api/me/menu", async (route) => {
    await said;
    await route.fulfill({ json: told });
  });
  const header = page.locator(".site-header");
  const pill = header.locator(".nav-pill");
  const mine = header.getByRole("link", { name: "My submissions" });
  const reviews = header.getByRole("link", { name: "My reviews" });
  const account = header.getByRole("link", { name: `Your account: ${NAME}`, exact: true });
  const languages = page.getByRole("navigation", { name: "Language" });
  const brand = header.getByRole("link", { name: "ELOchair", exact: true });
  const edges = async (target: Locator) => {
    const box = await target.boundingBox();
    if (!box) throw new Error("not on the page");
    return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
  };
  /** Where the keyboard stops in the header, in the order in which Tab reaches each place. */
  const stops = async () => {
    await brand.focus();
    const found: { left: number; right: number; top: number; bottom: number; last: boolean }[] = [];
    for (;;) {
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el?.closest(".site-header")) return null;
        const box = el.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          last: el.matches(".account a"),
        };
      });
      if (!stop) return found;
      found.push(stop);
      await page.keyboard.press("Tab");
    }
  };
  /** Each stop is to the right of the one before on the same row, or on a row below it. */
  const asSeen = (found: Awaited<ReturnType<typeof stops>>) =>
    found.map((stop, i) => {
      const before = found[i - 1];
      if (!before) return "first";
      const sameRow = stop.top < before.bottom && stop.bottom > before.top;
      if (sameRow) return stop.left >= before.right - 1 ? "to the right" : "BACK TO THE LEFT";
      return stop.top >= before.bottom - 1 ? "below" : "BACK UP";
    });

  // On a phone, someone with one proposal and a long name. Until the server has said who is
  // looking, the header shows neither a name nor "Sign in", and keeps the place of one.
  told = { ...told, submissions: true, reviews: false };
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/en/my");
  await expect(page.getByRole("heading", { level: 1, name: "My submissions" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Your account" })).toHaveCount(0);
  const before = await edges(page.getByRole("main"));
  say();
  await expectTouchTarget(account, 44);
  await expectTouchTarget(mine);
  // The page below is where it was: nothing moved when the name and the link arrived.
  expect((await edges(page.getByRole("main"))).top).toBe(before.top);
  await expect(mine).toHaveAttribute("aria-current", "page");
  await expect(account).not.toHaveAttribute("aria-current", "page");
  await expect(reviews).toHaveCount(0);
  // The link is beside the wordmark, on the upper row. The languages and the name are on the
  // lower one, the name at its right end. It is cut short where it does not fit (the whole of
  // it is still the link's name), and pushes nothing off the screen.
  expect((await edges(mine)).left).toBeGreaterThan((await edges(brand)).right);
  expect((await edges(mine)).bottom).toBeLessThanOrEqual((await edges(languages)).top);
  expect((await edges(account)).left).toBeGreaterThan((await edges(languages)).right);
  expect((await edges(account)).top).toBeLessThan((await edges(languages)).bottom);
  expect((await edges(account)).right).toBeLessThanOrEqual((await edges(pill)).right);
  expect((await edges(account)).right).toBeGreaterThan((await edges(pill)).right - 24);
  const name = header.locator(".account-name");
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);

  // On a wide screen the header is one row, in the order of the markup: the wordmark, the
  // person's pages, the languages and, last and at the right end, the name.
  await page.setViewportSize({ width: 1280, height: 800 });
  expect((await edges(pill)).bottom - (await edges(pill)).top).toBeLessThan(70);
  expect((await edges(languages)).left).toBeGreaterThan((await edges(mine)).right);
  expect((await edges(account)).left).toBeGreaterThan((await edges(languages)).right);
  expect((await edges(account)).right).toBeGreaterThan((await edges(pill)).right - 24);
  expect(
    await header.evaluate((el) =>
      [...el.querySelectorAll("a")].map((a) => a.textContent?.trim().split(" ")[0]),
    ),
  ).toEqual(["ELOchair", "My", "EN", "ES", "PT", "Your"]);
  await expectNoHorizontalScroll(page);

  // The fullest header there is, both links and the long name, in the three languages, from
  // a small phone to the narrowest screen that has it in one row: nothing is pushed off the
  // screen, the links stay whole and the name stays inside the header. And the keyboard goes
  // through it as it is seen, never back up a row or back to the left, whichever way the
  // links wrap: seven stops, from the wordmark to the name.
  told = { ...told, submissions: true, reviews: true };
  for (const lang of ["en", "es", "pt"]) {
    for (const width of [360, 390, 736, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${lang}/`);
      const own = header.getByRole("navigation").first().getByRole("link");
      await expect(own).toHaveCount(2);
      const which = `${lang} at ${width}`;
      await expectNoHorizontalScroll(page);
      const last = header.locator(".account a");
      expect((await edges(last)).right, which).toBeLessThanOrEqual((await edges(pill)).right);
      for (const link of await own.all()) {
        expect(await link.evaluate((el) => el.scrollWidth <= el.clientWidth), which).toBe(true);
        expect((await edges(link)).right, which).toBeLessThanOrEqual((await edges(pill)).right);
      }
      if (width >= 736) {
        expect((await edges(pill)).bottom - (await edges(pill)).top, which).toBeLessThan(70);
      }
      const found = await stops();
      expect(found, which).toHaveLength(7);
      expect(found.at(-1)?.last, which).toBe(true);
      expect(
        asSeen(found).filter((how) => how.startsWith("BACK")),
        which,
      ).toEqual([]);
    }
  }

  // Someone who has not said what they are called is known by their address.
  told = { view: "menu", account: { name: null, email: "someone.new@example.org" } };
  await page.goto("/en/");
  await expect(
    header.getByRole("link", { name: "Your account: someone.new@example.org", exact: true }),
  ).toBeVisible();
  await expect(header.getByRole("navigation", { name: "Main menu" })).toHaveCount(0);
});

test("the header shows the answer to its latest question: never one that comes late, and nobody when none comes", async ({
  page,
}) => {
  // Made up, as above: each question the header asks is answered from this list, in turn, and
  // an answer that has a gate waits for it.
  const somebody = (name: string) => ({
    view: "menu",
    account: { name, email: "made-up@example.org" },
    submissions: true,
  });
  const nobody = { view: "menu", account: null };
  const gate = () => {
    let open: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { open, closed, passed: false };
  };
  const first = gate();
  const afterBack = gate();
  const answers: { json?: object; fails?: true; gate?: ReturnType<typeof gate> }[] = [
    // The page arrives: answered last of all, with someone signed in.
    { json: somebody("Whoever Was Here"), gate: first },
    // Another page, answered at once: nobody is.
    { json: nobody },
    { json: somebody("Someone Else") },
    { fails: true },
    { json: somebody("Someone Else") },
    // The page brought back by the back button: answered after a while, with nobody.
    { json: nobody, gate: afterBack },
  ];
  let questions = 0;
  await page.route("**/api/me/menu", async (route) => {
    const answer = answers[questions];
    questions += 1;
    if (!answer) throw new Error("a question nobody expected");
    await answer.gate?.closed;
    if (answer.fails) await route.fulfill({ status: 500, json: { error: "made_up" } });
    else await route.fulfill({ json: answer.json });
    if (answer.gate) answer.gate.passed = true;
  });
  const header = page.locator(".site-header");
  const language = (name: string) => header.getByRole("link", { name, exact: true });
  const else_ = header.getByRole("link", { name: "Your account: Someone Else", exact: true });

  // What happens when someone signs out while an earlier question is on its way: the answer
  // to the earlier one comes last, and is dropped.
  await page.goto("/en/");
  await language("ES Español").click();
  await expect(header.getByRole("link", { name: "Entrar" })).toBeVisible();
  first.open();
  await expect.poll(() => first.passed).toBe(true);
  // Time for the late answer to be shown, if it were going to be.
  await page.waitForTimeout(300);
  await expect(header.getByRole("link", { name: "Entrar" })).toBeVisible();
  await expect(header.getByText("Whoever Was Here")).toHaveCount(0);
  await expect(header.getByRole("navigation", { name: "Menú principal" })).toHaveCount(0);

  // An answer that does not come leaves nobody in the header, not whoever was there before:
  // neither a name, nor their pages, nor "Sign in", which nothing has said.
  await language("EN English").click();
  await expect(else_).toBeVisible();
  await expect(header.getByRole("link", { name: "My submissions" })).toBeVisible();
  await language("PT Português").click();
  await expect(header.getByText("Someone Else")).toHaveCount(0);
  await expect(header.getByRole("navigation", { name: "Menu principal" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Entrar" })).toHaveCount(0);

  // The browser brings a page back as it was left (the back button, from another site): the
  // header forgets who it showed before it asks, because they may have signed out since.
  // (The test browser keeps no pages to bring back, so the browser's event is made up too.)
  await language("EN English").click();
  await expect(else_).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  );
  await expect(header.getByText("Someone Else")).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  afterBack.open();
  await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
  // A page shown for the first time, or again without having been kept, changes nothing.
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })),
  );
  await page.waitForTimeout(300);
  expect(questions).toBe(answers.length);
});

test("with reduced motion nothing moves; otherwise only decoration does", async ({ page }) => {
  const animated = () =>
    page.evaluate(() =>
      document.getAnimations().map((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return target?.matches(".glow, .hero h1") ? "decoration" : (target?.className ?? "?");
      }),
    );
  await page.goto(`/en/c/${CALL}`);
  await expect(page.locator(".hero h1")).toBeVisible();
  const moving = await animated();
  expect(moving.length).toBeGreaterThan(0);
  expect(moving.filter((x) => x !== "decoration")).toEqual([]);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator(".hero h1")).toBeVisible();
  expect(await animated()).toEqual([]);
});

/** The pages that put the invitation on the band: the call's own page, and the front page. */
for (const path of [`/en/c/${CALL}`, "/en/"]) {
  test(`text on the band keeps 4.5:1 against the brightest point of the glow fields (${path})`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page.locator(".hero h1")).toBeVisible();
    await expectBandContrast(page);
  });
}

async function expectBandContrast(page: Page) {
  // The band's text colours, from the tokens — set on .shell (see tokens.css), not :root, so an
  // undressed conference's page doesn't inherit ELO 2027's palette.
  const colours = await page.evaluate(() => {
    const shell = document.querySelector(".shell");
    if (!shell) throw new Error("no .shell element");
    const style = getComputedStyle(shell);
    return ["--band-text", "--band-muted", "--band-accent", "--band-echo"].map(
      (name) => [name, style.getPropertyValue(name).trim()] as const,
    );
  });
  // Every text in the hero is in one of those four colours, so the measurement below covers
  // it. (Text on a filled button sits on the button's own colour, which axe measures.)
  const used = await page.locator(".hero").evaluate((hero) => {
    const found = new Set<string>();
    const walker = document.createTreeWalker(hero, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim()) continue;
      if (parent.closest(".button:not(.secondary)")) continue;
      found.add(getComputedStyle(parent).color);
    }
    return [...found];
  });
  const asRgb = (hex: string) =>
    `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
  const allowed = colours.map(([, hex]) => asRgb(hex));
  expect(used.length).toBeGreaterThan(1);
  for (const colour of used) expect(allowed, `${colour} is a band colour`).toContain(colour);
  // Only the art, with nothing over it; then the glow fields at several points of their drift.
  await page.addStyleTag({
    content: ".shell > :not(.band-art) { visibility: hidden !important; }",
  });
  let brightest = 0;
  for (const seconds of [0, 7, 13, 20, 26, 38]) {
    await page.addStyleTag({
      content: `.glow { animation-delay: -${seconds}s !important; animation-play-state: paused !important; }`,
    });
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 390, height: 800 } });
    const luminance = await page.evaluate(async (png) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no canvas");
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const linear = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      let max = 0;
      for (let i = 0; i < data.length; i += 8) {
        const l =
          0.2126 * linear(data[i] ?? 0) +
          0.7152 * linear(data[i + 1] ?? 0) +
          0.0722 * linear(data[i + 2] ?? 0);
        if (l > max) max = l;
      }
      return max;
    }, shot.toString("base64"));
    brightest = Math.max(brightest, luminance);
  }
  const linear = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  for (const [name, hex] of colours) {
    expect(hex, name).toMatch(/^#[0-9a-f]{6}$/i);
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const text = 0.2126 * linear(r ?? 0) + 0.7152 * linear(g ?? 0) + 0.0722 * linear(b ?? 0);
    const ratio = (text + 0.05) / (brightest + 0.05);
    expect(ratio, `${name} ${hex} on the band`).toBeGreaterThanOrEqual(4.5);
  }
}

test("fonts and images come from the app's own origin, within the content security policy", async ({
  page,
  baseURL,
}) => {
  const elsewhere: string[] = [];
  const fonts: string[] = [];
  const refused: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    if (!url.startsWith(baseURL as string)) elsewhere.push(url);
    if (/\.woff2?$/.test(new URL(url).pathname)) fonts.push(url);
  });
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
  });
  // Only pages wearing the identity (a dressed conference's own routes, and the front page
  // while it is that conference's invitation) should fetch its fonts. Generic chrome (sign-in,
  // the account) is plain for every conference — see the next test.
  // networkidle (not just fonts.ready) because the hero's one-time focus-in animation can delay
  // when its heading is first painted, and so when its font is first requested.
  for (const path of ["/en/", `/en/c/${CALL}`, `/es/c/${CALL}`, `/en/c/${CALL}/submit`]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
  }
  expect(elsewhere).toEqual([]);
  expect(refused).toEqual([]);
  // The interface, heading and wordmark faces were really requested, not just declared: checking
  // the actual network requests avoids a `document.fonts` status race against the hero's one-time
  // focus-in animation, which can delay when a glyph is first painted (and so first requested).
  const requestedFamilies = ["schibsted-grotesk", "bricolage-grotesque", "unbounded"].map((slug) =>
    fonts.some((url) => url.includes(slug)),
  );
  expect(requestedFamilies).toEqual([true, true, true]);
});

test("a plain conference, and the app's own pages, wear no identity at all", async ({ page }) => {
  const fonts: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/\.woff2?$/.test(new URL(url).pathname)) fonts.push(url);
  });

  // elo2026 has no entry in dressedAs(): its conference page gets no hero, no band, no fonts.
  await page.goto("/en/c/elo2026");
  await expect(page.locator(".shell")).not.toHaveClass(/shell-hero/);
  await expect(page.locator(".shell")).not.toHaveAttribute("data-dressed");
  await expect(page.locator("article.conference")).toBeVisible();

  // Generic chrome pages are plain too: no slug, so never dressed.
  for (const path of ["/en/my", "/es/me", "/pt/sign-in"]) {
    await page.goto(path);
    await expect(page.locator(".shell")).not.toHaveAttribute("data-dressed");
    await expect(page.locator("[data-dressed]")).toHaveCount(0);
  }

  // So is the front page when the conference it features has no identity: here, as if ELO 2026
  // were the only conference. (It wears one only as the invitation of a conference that has
  // one; the test above reads that.)
  const all = (await (await page.request.get("/api/conferences")).json()) as {
    conferences: { slug: string }[];
  };
  await page.route("**/api/conferences", (route) =>
    route.fulfill({ json: { conferences: all.conferences.filter((k) => k.slug === "elo2026") } }),
  );
  await page.goto("/en/");
  await expect(page.locator(".feature")).toBeVisible();
  await expect(page.locator("[data-dressed]")).toHaveCount(0);

  await page.evaluate(() => document.fonts.ready);
  expect(fonts).toEqual([]);
});
