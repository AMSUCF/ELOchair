import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

/*
 * The ELO 2027 identity (docs/design/visual-identity.md): what it shows, and the promises it
 * keeps while showing it: contrast on the band, touch targets, no motion when asked, nothing
 * fetched from elsewhere.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const CALL = "elo2027-open";

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
  await expect(hero.getByRole("heading", { level: 1 })).toHaveText("ELO 2027 (open test call)");
  await expect(hero.getByText("Electronic Literature Organization Conference")).toBeVisible();
  await expect(hero.getByText("Ecologies of Attention", { exact: true })).toBeVisible();
  await expect(hero.getByText("10.96° N 74.80° W")).toBeVisible();
  await expect(hero.getByText("Universidad del Norte")).toBeVisible();
  // The echo is the theme in the conference's other language: shown, but not read out twice.
  const echo = hero.locator(".hero-echo .echo");
  await expect(echo).toHaveText("Ecologías de la atención");
  await expect(echo).toHaveAttribute("lang", "es");
  await expect(echo).toHaveAttribute("aria-hidden", "true");
  // The countdown shows only because the server says the call is open.
  await expect(hero.locator(".countdown")).toHaveText(/^\d+ days? left$/i);
  await expect(hero.getByRole("link", { name: "Submit a proposal" })).toBeVisible();

  await expect(page.getByRole("link", { name: /Read the full call/ })).toHaveAttribute(
    "href",
    "https://elo27.eliterature.org/",
  );
  // Section headings are named in the page's language only; the echo is decoration.
  await expect(
    page.getByRole("heading", { level: 2, name: "Submission formats", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#formats .echo")).toHaveText("Formatos de envío");
  await expect(page.locator(".formats > li")).toHaveCount(6);
  await expect(page.locator(".formats > li").first()).toContainText("350–500 words");
  await expect(page.locator(".timeline > li")).toHaveCount(5);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);

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

test("the home page features the open call once, above the other conferences", async ({ page }) => {
  await page.goto("/en/");
  await expect(page.getByRole("heading", { level: 1, name: "Conferences" })).toBeVisible();
  const feature = page.locator(".feature");
  await expect(feature.getByRole("heading", { level: 2 })).toHaveText("ELO 2027 (open test call)");
  await expect(feature.getByText("Call for proposals open")).toBeVisible();
  await expect(feature.locator(".hero-theme")).toContainText("Ecologies of Attention");
  await expect(feature.getByRole("link", { name: "Submit a proposal" })).toHaveAttribute(
    "href",
    `/en/c/${CALL}/submit`,
  );
  await expect(feature.getByRole("link", { name: "See the call" })).toHaveAttribute(
    "href",
    `/en/c/${CALL}`,
  );
  // Featured, so not listed again.
  await expect(page.getByRole("heading", { level: 2, name: "Other conferences" })).toBeVisible();
  await expect(page.locator(".cards").getByRole("link", { name: /open test call/ })).toHaveCount(0);
  await expect(
    page.locator(".cards").getByRole("link", { name: "ELO 2026: (un)supervised" }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNoHorizontalScroll(page);
});

test("the header fits a small phone, and everything in it is a touch target", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/en/my");
  const header = page.locator(".site-header");
  await expectTouchTarget(header.getByRole("link", { name: "ELOchair", exact: true }));
  const account = header.getByRole("link", { name: "Your account" });
  const mine = header.getByRole("link", { name: "My submissions" });
  await expectTouchTarget(account);
  await expectTouchTarget(mine);
  // The page you are on is marked for assistive technology, not only by colour.
  await expect(mine).toHaveAttribute("aria-current", "page");
  await expect(account).not.toHaveAttribute("aria-current", "page");

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

test("text on the band keeps 4.5:1 against the brightest point of the glow fields", async ({
  page,
}) => {
  await page.goto(`/en/c/${CALL}`);
  await expect(page.locator(".hero h1")).toBeVisible();
  // The band's text colours, from the tokens.
  const colours = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return ["--band-text", "--band-muted", "--band-accent", "--band-echo"].map(
      (name) => [name, style.getPropertyValue(name).trim()] as const,
    );
  });
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
});

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
  for (const path of [`/en/c/${CALL}`, "/es/", "/pt/sign-in"]) {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
  }
  expect(elsewhere).toEqual([]);
  expect(refused).toEqual([]);
  expect(fonts.length).toBeGreaterThan(0);
  // The interface, heading and label faces really are in use, not their fallbacks.
  const loaded = await page.evaluate(() =>
    ["Schibsted Grotesk Variable", "Bricolage Grotesque Variable", "Unbounded"].map((family) =>
      [...document.fonts].some((f) => f.family.includes(family) && f.status === "loaded"),
    ),
  );
  expect(loaded).toEqual([true, true, true]);
});
