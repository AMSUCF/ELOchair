import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

/*
 * A call's formats on its conference's page, one at a time (spec 02, §1.10; the design is the
 * formats view of docs/design/visitor-preview): a chooser, and one panel for the chosen format.
 * The section is public, so nobody signs in here.
 *
 * The tests hold the page to the conference's configuration, whatever it says. They read it as
 * the page itself received it (`open`), because the settings tests change some of it while
 * these run: the length of one format's abstract, and the end of the Spanish sentence that
 * introduces the formats, which is therefore read by its beginning.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/** The call that is always open: ELO 2027's own configuration on dates that follow the clock. */
const CALL = "elo2027-open";

type Texts = Record<string, string>;
type Mode = "double" | "single" | "open";
type Type = {
  key: string;
  name: Texts;
  description: Texts;
  reviewPool: string;
  blindMode?: Mode;
  abstract: { label: Texts; minWords?: number; maxWords: number };
  durationMinutes?: number;
  team: { min: number; max: number };
  fields: { key: string; label: Texts; required: boolean }[];
};
type Other = { key: string; name: Texts; description: Texts };
type Conference = {
  callState: "open" | "upcoming" | "closed";
  config: {
    languages: string[];
    website?: string;
    formatsIntro?: Texts;
    reviewPools: { key: string; name: Texts; blindMode: Mode }[];
    submissionTypes: Type[];
    otherFormats: Other[];
    contributionGroups: { name: Texts; formats: string[] }[];
  };
};

/** How each way of reviewing is said to the people who submit. */
const REVIEW: Record<Mode, string> = {
  double: "Anonymized review: reviewers do not see who you are.",
  single: "Reviewers see names and affiliations, but not bios or contact details.",
  open: "Open review: reviewers see names, affiliations and bios.",
};

const two = (n: number) => String(n).padStart(2, "0");
const range = (min: number, max: number) => (min === max ? String(min) : `${min}–${max}`);
const formatsOf = ({ config }: Conference): (Type | Other)[] => [
  ...config.submissionTypes,
  ...config.otherFormats,
];
const submittedHere = (format: Type | Other): format is Type => "abstract" in format;

/** A text the configuration must hold for the test to mean anything. */
function held<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === "") throw new Error(`the configuration has no ${what}`);
  return value;
}

/** What a conference's page is told about the conference, the next time it asks. */
const told = (page: Page, slug: string) =>
  page
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/conferences/${slug}` && response.ok(),
    )
    .then((response) => response.json() as Promise<Conference>);

/**
 * Opens a conference's page afresh, and answers with what that page was told about the
 * conference. (An address that differs only after the "#" would not load the page again.)
 */
async function open(page: Page, slug: string, rest = ""): Promise<Conference> {
  if (new URL(page.url()).pathname === `/en/c/${slug}`) await page.goto("about:blank");
  const answer = told(page, slug);
  await page.goto(`/en/c/${slug}${rest}`);
  return answer;
}

const section = (page: Page) => page.getByRole("region", { name: "Submission formats" });
const panel = (page: Page) => page.locator(".format-panel");
const chooser = (page: Page) =>
  section(page).getByRole("combobox", { name: "Format", exact: true });

/** axe in the light theme and again in the dark one. */
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
async function expectTouchTarget(target: Locator) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

/** The smallest size of any text the section shows, in px, and the text that has it. */
const smallestText = (page: Page) =>
  section(page).evaluate((root) => {
    let smallest = { size: Number.POSITIVE_INFINITY, text: "" };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent?.trim() ?? "";
      if (!parent || !text || !parent.checkVisibility()) continue;
      const size = Number.parseFloat(getComputedStyle(parent).fontSize);
      if (size < smallest.size) smallest = { size, text };
    }
    return smallest;
  });

/** Whether an element shows a focus ring, as the styles draw one: an outline. */
const ring = (target: Locator) =>
  target.evaluate((el) => {
    const style = getComputedStyle(el);
    return style.outlineStyle === "none" ? "none" : `${style.outlineWidth} ${style.outlineStyle}`;
  });

/**
 * The panel shows one format, and says everything the configuration holds of it: its place and
 * name, its figures, what it is, what the form asks for, who reviews it and how, and what a
 * visitor can do about it now.
 */
async function expectPanel(page: Page, slug: string, conference: Conference, index: number) {
  const { config, callState } = conference;
  const formats = formatsOf(conference);
  const format = held(formats[index], `format ${index + 1}`);
  const shown = panel(page);
  await expect(shown).toHaveCount(1);

  // Its place among the formats: as the design sets it, and in words for people who hear it.
  const position = shown.locator(".format-position");
  await expect(position).toContainText(`Format ${two(index + 1)} / ${two(formats.length)}`);
  await expect(position).toContainText(`Format ${index + 1} of ${formats.length}`);

  // Its name is the panel's heading, the only one of its level in the section; the name in the
  // conference's other language is under it, shown and not read out.
  const name = held(format.name.en, "name of a format");
  const heading = section(page).getByRole("heading", { level: 3 });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveAccessibleName(name);
  await expect(heading).toHaveAttribute("id", `format-${format.key}`);
  const echo = heading.locator(".echo");
  if (format.name.es && format.name.es !== name) {
    await expect(echo).toHaveText(format.name.es);
    await expect(echo).toHaveAttribute("lang", "es");
    await expect(echo).toHaveAttribute("aria-hidden", "true");
  } else {
    await expect(echo).toHaveCount(0);
  }
  await expect(shown.locator(".format-description")).toHaveText(
    held(format.description.en, "description of a format"),
  );

  if (!submittedHere(format)) {
    // A format the call takes some other way: it says so where the figures would be, and
    // offers the way to the official call instead of the way to start a proposal.
    await expect(shown.locator(".format-elsewhere")).toHaveText("Not submitted here");
    await expect(shown.locator(".stats")).toHaveCount(0);
    await expect(shown.locator(".format-details")).toHaveCount(0);
    await expect(shown.getByRole("link", { name: "Start this proposal" })).toHaveCount(0);
    const official = shown.getByRole("link", { name: "Official format requirements" });
    if (config.website) await expect(official).toHaveAttribute("href", config.website);
    else await expect(official).toHaveCount(0);
    return;
  }

  // Its figures, each with what it counts: the abstract's words, the minutes of its slot where
  // it has one, the people on a proposal.
  const { minWords, maxWords } = format.abstract;
  await expect(shown.locator(".stats > li")).toHaveText([
    minWords ? `${range(minWords, maxWords)} words` : `${maxWords} words at most`,
    ...(format.durationMinutes ? [`${format.durationMinutes} minutes`] : []),
    `${range(format.team.min, format.team.max)} ${format.team.max === 1 ? "person" : "people"}`,
  ]);
  await expect(shown.locator(".format-elsewhere")).toHaveCount(0);

  // What the form asks for: the abstract by its own name, then the other fields; the required
  // ones say so.
  const details = shown.locator(".format-details");
  await expect(details.locator("dt")).toHaveText(["The form asks for", "Reviewed by"]);
  await expect(details.locator(".format-asks > li")).toHaveText([
    `${held(format.abstract.label.en, "name of the abstract")}${minWords === 0 ? "" : " required"}`,
    ...format.fields.map(
      (field) => `${held(field.label.en, "label of a field")}${field.required ? " required" : ""}`,
    ),
  ]);

  // Who reviews it, and how: one sentence.
  const pool = held(
    config.reviewPools.find((p) => p.key === format.reviewPool),
    "pool of a format",
  );
  await expect(details.locator(".format-committee")).toHaveText(held(pool.name.en, "pool's name"));
  await expect(details).toContainText(REVIEW[format.blindMode ?? pool.blindMode]);

  // What a visitor can do now, by where the call stands (the server says).
  const start = shown.getByRole("link", { name: "Start this proposal", exact: true });
  if (callState === "open") {
    await expect(start).toHaveAttribute("href", `/en/c/${slug}/submit?format=${format.key}`);
    await expect(start.locator(".echo")).toHaveText("Iniciar esta propuesta");
  } else {
    await expect(start).toHaveCount(0);
    await expect(shown.locator(".status-line")).toContainText(
      callState === "closed" ? "The submission window has closed." : /^Submissions open /,
    );
  }
}

test("on a phone the formats are one select and one panel, and the panel says all the configuration holds", async ({
  page,
}) => {
  test.slow();
  const conference = await open(page, CALL);
  const { config } = conference;
  const formats = formatsOf(conference);
  expect(conference.callState).toBe("open");
  const here = section(page);

  // The start of the section: its heading, the sentence that introduces the formats, the
  // languages proposals may be in, and the way to the official call.
  const title = here.getByRole("heading", { level: 2, name: "Submission formats", exact: true });
  await expect(title).toBeVisible();
  await expect(title.locator(".echo")).toHaveText("Formatos de envío");
  const intro = here.locator(".formats-intro");
  await expect(intro).toContainText(held(config.formatsIntro?.en, "sentence about the formats"));
  const introEcho = intro.locator(".echo");
  await expect(introEcho).toContainText(
    held(config.formatsIntro?.es, "that sentence in Spanish").slice(0, 60),
  );
  await expect(introEcho).toHaveAttribute("lang", "es");
  await expect(introEcho).toHaveAttribute("aria-hidden", "true");
  const languages = (lang: string) => {
    const names = new Intl.DisplayNames([lang], { type: "language" });
    return new Intl.ListFormat(lang, { type: "disjunction" }).format(
      config.languages.map((code) => names.of(code) ?? code),
    );
  };
  await expect(here.locator(".formats-lead")).toContainText(`Proposals in ${languages("en")}.`);
  await expect(here.locator(".formats-lead")).toContainText(`Propuestas en ${languages("es")}.`);
  const official = here
    .locator(".formats-lead")
    .getByRole("link", { name: "Official format requirements", exact: true });
  await expect(official).toHaveAttribute("href", held(config.website, "website"));
  await expect(official.locator(".echo")).toHaveText("Requisitos oficiales de los formatos");
  await expectTouchTarget(official);

  // The chooser is a labelled select with every format of the call, in the call's order. The
  // first is chosen. The list a wide screen shows is not there, for anyone.
  const select = chooser(page);
  await expect(select).toBeVisible();
  expect(await select.evaluate((el) => el.tagName)).toBe("SELECT");
  await expect(select.locator("option")).toHaveText(
    formats.map((format, i) => `${two(i + 1)} · ${format.name.en}`),
  );
  await expect(select).toHaveValue(held(formats[0], "format").key);
  await expectTouchTarget(select);
  await expect(here.locator(".format-list")).toBeHidden();
  await expect(here.locator(".format-choice").first()).toBeHidden();
  await expectPanel(page, CALL, conference, 0);
  // Nothing was chosen yet, so nothing is announced.
  await expect(here.getByRole("status")).toHaveText("");

  // Each format in turn: the panel changes, the select keeps the focus, the address names the
  // format, and the choice is said once for people who do not see the panel change.
  await select.focus();
  for (const [i, format] of formats.entries()) {
    if (i === 0) continue;
    await select.selectOption(format.key);
    await expectPanel(page, CALL, conference, i);
    await expect(select).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/en/c/${CALL}#format-${format.key}$`));
    await expect(here.getByRole("status")).toHaveText(
      `Showing ${format.name.en}: format ${i + 1} of ${formats.length}.`,
    );
  }

  // The last one (a format that is not submitted here, where the call has one), then one with
  // the most a panel can hold: both read well in both themes, at both phone widths, in sizes
  // people can read.
  const full = Math.max(
    0,
    config.submissionTypes.findIndex((type) => type.fields.length > 0 && type.durationMinutes),
  );
  for (const index of [formats.length - 1, full]) {
    await select.selectOption(held(formats[index], "format").key);
    await expectPanel(page, CALL, conference, index);
    await expectAccessible(page);
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoHorizontalScroll(page);
      const smallest = await smallestText(page);
      expect(smallest.size, `“${smallest.text}” at ${width}px`).toBeGreaterThanOrEqual(13);
    }
  }
  await expectTouchTarget(panel(page).getByRole("link", { name: "Start this proposal" }));
  await expectTouchTarget(panel(page).getByRole("button", { name: "Previous" }));
  await expectTouchTarget(panel(page).getByRole("button", { name: "Next" }));

  // In Spanish the pairs turn round, and the select is labelled in Spanish.
  await page.goto(`/es/c/${CALL}#format-${held(formats[0], "format").key}`);
  const first = held(formats[0], "format");
  await expect(
    page.getByRole("heading", { level: 3, name: held(first.name.es, "name in Spanish") }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Formato", exact: true })).toHaveValue(first.key);
  await expect(panel(page).getByRole("link", { name: "Iniciar esta propuesta" })).toHaveAttribute(
    "href",
    `/es/c/${CALL}/submit?format=${first.key}`,
  );
  await expect(panel(page).getByRole("button", { name: "Siguiente" })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("Previous and Next step through the formats and go round at the ends; a heading that takes the focus shows no ring, and the controls do", async ({
  page,
}) => {
  const conference = await open(page, CALL, "#formats");
  const formats = formatsOf(conference);
  const last = formats.length - 1;
  const here = section(page);

  // The address names the section: it is in view, its heading has the focus so that reading
  // goes on from it, and no ring is drawn around the heading. The first format is chosen.
  const title = here.getByRole("heading", { level: 2, name: "Submission formats", exact: true });
  await expect(title).toBeFocused();
  await expect(title).toBeInViewport();
  expect(await ring(title)).toBe("none");
  await expectPanel(page, CALL, conference, 0);

  // The keyboard goes on from there, and what it reaches shows where it is.
  await page.keyboard.press("Tab");
  const official = here.locator(".formats-lead").getByRole("link");
  await expect(official).toBeFocused();
  expect(await ring(official)).toBe("3px solid");
  await page.keyboard.press("Tab");
  await expect(chooser(page)).toBeFocused();
  expect(await ring(chooser(page))).toBe("3px solid");

  // Previous from the first format is the last; Next from the last is the first again.
  const previous = panel(page).getByRole("button", { name: "Previous", exact: true });
  const next = panel(page).getByRole("button", { name: "Next", exact: true });
  await expect(previous.locator(".echo")).toHaveText("Anterior");
  await expect(next.locator(".echo")).toHaveText("Siguiente");
  const entries = await page.evaluate(() => history.length);
  await previous.focus();
  await page.keyboard.press("Enter");
  await expectPanel(page, CALL, conference, last);
  await expect(previous).toBeFocused();
  expect(await ring(previous)).toBe("3px solid");
  await expect(chooser(page)).toHaveValue(held(formats[last], "format").key);
  await expect(here.getByRole("status")).toHaveText(
    `Showing ${held(formats[last], "format").name.en}: format ${last + 1} of ${formats.length}.`,
  );
  await next.focus();
  await page.keyboard.press("Enter");
  await expectPanel(page, CALL, conference, 0);
  await expect(next).toBeFocused();
  await page.keyboard.press("Enter");
  await expectPanel(page, CALL, conference, 1);
  await expect(next).toBeFocused();
  await expect(here.getByRole("status")).toHaveText(
    `Showing ${held(formats[1], "format").name.en}: format 2 of ${formats.length}.`,
  );
  // The address names the format on show, without a new entry in the history for each step:
  // Back leaves the page, as it did.
  const second = held(formats[1], "format");
  await expect(page).toHaveURL(new RegExp(`/en/c/${CALL}#format-${second.key}$`));
  expect(await page.evaluate(() => history.length)).toBe(entries);

  // So the address can be kept or passed on: opened again, it shows that format, in view.
  const again = await open(page, CALL, `#format-${second.key}`);
  await expectPanel(page, CALL, again, 1);
  const name = here.getByRole("heading", { level: 3 });
  await expect(name).toBeFocused();
  await expect(name).toBeInViewport();
  expect(await ring(name)).toBe("none");

  // An address that names no format of the call shows the first, and takes nobody anywhere.
  const unknown = await open(page, CALL, "#format-no_such_format");
  await expectPanel(page, CALL, unknown, 0);
  await expect(chooser(page)).toHaveValue(held(formats[0], "format").key);
});

test("a way to contribute arrives at the formats with its first format chosen, in view and in focus", async ({
  page,
}) => {
  // From the front page, the last way to contribute: the conference's page opens at its formats.
  await page.goto("/en/");
  const ways = page.getByRole("region", { name: "Ways to contribute" });
  await expect(ways.getByRole("link").last()).toBeVisible();
  const answer = told(page, CALL);
  await ways.getByRole("link").last().click();
  const conference = await answer;
  const formats = formatsOf(conference);
  const groups = conference.config.contributionGroups;
  const lastGroup = held(groups.at(-1), "way to contribute");
  const arrived = held(lastGroup.formats[0], "format of that way");
  await expect(page).toHaveURL(new RegExp(`/en/c/${CALL}#format-${arrived}$`));
  const index = formats.findIndex((format) => format.key === arrived);
  await expectPanel(page, CALL, conference, index);

  // The section is shown from its start, so that people see where they are; the format's name
  // has the focus, so that reading and the keyboard go on from it, and shows no focus ring.
  const here = section(page);
  const name = here.getByRole("heading", { level: 3 });
  await expect(name).toBeFocused();
  await expect(name).toBeInViewport();
  await expect(here.getByRole("heading", { level: 2 })).toBeInViewport();
  expect(await ring(name)).toBe("none");
  await expect(chooser(page)).toHaveValue(arrived);
  // Arriving says nothing more: the heading that has the focus is read.
  await expect(here.getByRole("status")).toHaveText("");

  // On the conference's own page the same links stay on the page: another way, another format.
  const firstGroup = held(groups[0], "way to contribute");
  const other = held(firstGroup.formats[0], "format of that way");
  expect(other).not.toBe(arrived);
  await page
    .getByRole("region", { name: "Ways to contribute" })
    .getByRole("link", { name: `(${held(firstGroup.name.en, "name")})` })
    .click();
  await expect(page).toHaveURL(new RegExp(`/en/c/${CALL}#format-${other}$`));
  await expectPanel(
    page,
    CALL,
    conference,
    formats.findIndex((format) => format.key === other),
  );
  await expect(name).toBeFocused();
  await expect(name).toBeInViewport();
  await expect(chooser(page)).toHaveValue(other);

  // The same link taken again, after choosing another format in place, goes back to its own.
  await chooser(page).selectOption(arrived);
  await expect(name).toHaveAttribute("id", `format-${arrived}`);
  await page
    .getByRole("region", { name: "Ways to contribute" })
    .getByRole("link", { name: `(${held(firstGroup.name.en, "name")})` })
    .click();
  await expect(name).toHaveAttribute("id", `format-${other}`);
  await expect(name).toBeFocused();
});

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  /** Contrast between two colours as the browser computed them ("rgb(r, g, b)"). */
  const contrast = (a: string, b: string) => {
    const luminance = (colour: string) => {
      const [r, g, b] = (colour.match(/[\d.]+/g) ?? []).map(Number);
      const linear = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(r ?? 0) + 0.7152 * linear(g ?? 0) + 0.0722 * linear(b ?? 0);
    };
    const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
    return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
  };
  const colour = (target: Locator, property: "backgroundColor" | "borderTopColor") =>
    target.evaluate((el, name) => getComputedStyle(el)[name], property);

  test("the chooser is the list of the formats beside the panel, and the chosen one and the panel stand apart in both themes", async ({
    page,
  }) => {
    test.slow();
    const conference = await open(page, CALL);
    const { config } = conference;
    const formats = formatsOf(conference);
    const here = section(page);

    // The list: a button for each format, with its number, its name, its echo and the
    // committee that reviews it (or that it is not submitted here). The select is not there.
    const list = here.getByRole("list", { name: "Format", exact: true });
    const rows = list.getByRole("button");
    await expect(rows).toHaveCount(formats.length);
    await expect(here.locator(".format-select")).toBeHidden();
    for (const [i, format] of formats.entries()) {
      const row = rows.nth(i);
      const pool = submittedHere(format)
        ? held(
            config.reviewPools.find((p) => p.key === format.reviewPool),
            "pool",
          ).name.en
        : "Not submitted here";
      await expect(row).toHaveAccessibleName(`${format.name.en} ${pool}`);
      await expect(row.locator(".format-number")).toHaveText(two(i + 1));
      if (format.name.es && format.name.es !== format.name.en) {
        await expect(row.locator(".echo")).toHaveText(format.name.es);
      }
    }
    // The first is chosen on arrival, and says so to everyone: it is the only current one.
    await expect(rows.nth(0)).toHaveAttribute("aria-current", "true");
    await expect(list.locator("[aria-current]")).toHaveCount(1);
    await expectPanel(page, CALL, conference, 0);

    // The list is to the left of the panel, and they begin level.
    const [listBox, panelBox] = [await list.boundingBox(), await panel(page).boundingBox()];
    expect((listBox?.x ?? 0) + (listBox?.width ?? 0)).toBeLessThanOrEqual(panelBox?.x ?? 0);
    expect(Math.abs((listBox?.y ?? 0) - (panelBox?.y ?? 99))).toBeLessThanOrEqual(1);

    // Choosing with the pointer: the panel changes, the row keeps the focus, the address names
    // the format, and the choice is said once.
    const third = held(formats[2], "third format");
    await rows.nth(2).click();
    await expectPanel(page, CALL, conference, 2);
    await expect(rows.nth(2)).toHaveAttribute("aria-current", "true");
    await expect(list.locator("[aria-current]")).toHaveCount(1);
    await expect(rows.nth(2)).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/en/c/${CALL}#format-${third.key}$`));
    await expect(here.getByRole("status")).toHaveText(
      `Showing ${third.name.en}: format 3 of ${formats.length}.`,
    );
    // The page did not move under the person choosing.
    const before = await page.evaluate(() => window.scrollY);
    await rows.nth(1).click();
    await expectPanel(page, CALL, conference, 1);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);

    // Choosing with the keyboard: the next row, with Enter; it shows a focus ring.
    await page.keyboard.press("Tab");
    await expect(rows.nth(2)).toBeFocused();
    await page.keyboard.press("Enter");
    await expectPanel(page, CALL, conference, 2);
    await expect(rows.nth(2)).toBeFocused();
    expect(
      await rows.nth(2).evaluate((el) => {
        const style = getComputedStyle(el);
        return `${style.outlineWidth} ${style.outlineStyle}`;
      }),
    ).toBe("3px solid");

    // Previous and Next move the mark in the list, and go round at the ends.
    await rows.nth(0).click();
    await panel(page).getByRole("button", { name: "Previous", exact: true }).click();
    await expectPanel(page, CALL, conference, formats.length - 1);
    await expect(rows.last()).toHaveAttribute("aria-current", "true");
    await panel(page).getByRole("button", { name: "Next", exact: true }).click();
    await expectPanel(page, CALL, conference, 0);
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await expect(list.locator("[aria-current]")).toHaveCount(1);

    // In both themes the panel's edge, the chosen row and the edge of every other row keep 3:1
    // against what is around them (the sheet; the rows that are not chosen), and nothing is
    // smaller than 13px.
    const sheet = page.locator(".sheet").last();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      const behind = await colour(sheet, "backgroundColor");
      const edge = await colour(panel(page), "borderTopColor");
      expect(
        contrast(edge, behind),
        `${colorScheme}: the panel's edge on the sheet`,
      ).toBeGreaterThanOrEqual(3);
      const chosen = await colour(rows.nth(0), "backgroundColor");
      const others = await colour(rows.nth(1), "backgroundColor");
      expect(
        contrast(chosen, others),
        `${colorScheme}: the chosen row beside the others`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(chosen, behind),
        `${colorScheme}: the chosen row on the sheet`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(await colour(rows.nth(1), "borderTopColor"), behind),
        `${colorScheme}: the edge of a row that is not chosen, on the sheet`,
      ).toBeGreaterThanOrEqual(3);
    }
    await page.emulateMedia({ colorScheme: "light" });
    const smallest = await smallestText(page);
    expect(smallest.size, `“${smallest.text}”`).toBeGreaterThanOrEqual(13);
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
  });

  test("a way to contribute arrives with its format chosen in the list, and the heading shows no focus ring", async ({
    page,
  }) => {
    const conference = await open(page, CALL);
    const formats = formatsOf(conference);
    const group = held(conference.config.contributionGroups.at(-1), "way to contribute");
    const key = held(group.formats[0], "format of that way");
    const index = formats.findIndex((format) => format.key === key);
    await page
      .getByRole("region", { name: "Ways to contribute" })
      .getByRole("link", { name: `(${held(group.name.en, "name")})` })
      .click();
    await expect(page).toHaveURL(new RegExp(`/en/c/${CALL}#format-${key}$`));
    await expectPanel(page, CALL, conference, index);
    const rows = section(page)
      .getByRole("list", { name: "Format", exact: true })
      .getByRole("button");
    await expect(rows.nth(index)).toHaveAttribute("aria-current", "true");
    const name = section(page).getByRole("heading", { level: 3 });
    await expect(name).toBeFocused();
    await expect(name).toBeInViewport();
    await expect(section(page).getByRole("heading", { level: 2 })).toBeInViewport();
    expect(await ring(name)).toBe("none");
    // The address alone does the same when the page is opened afresh, for a format and for
    // the section. (A browser shows a focus ring on what a script focuses in a page that has
    // just loaded: this is where a ring around a heading would show.)
    await open(page, CALL, `#format-${key}`);
    await expect(rows.nth(index)).toHaveAttribute("aria-current", "true");
    await expect(name).toBeFocused();
    await expect(name).toBeInViewport();
    expect(await ring(name)).toBe("none");
    await open(page, CALL, "#formats");
    const title = section(page).getByRole("heading", { level: 2 });
    await expect(title).toBeFocused();
    expect(await ring(title)).toBe("none");
    await expect(rows.nth(0)).toHaveAttribute("aria-current", "true");
  });
});

/*
 * The view is the structure of every conference's page, not ELO 2027's dress: a conference in
 * the plain look gets the same one. These two have closed calls, one language and no site.
 */
for (const slug of ["elo2026", "sandbox"]) {
  test(`${slug} shows its formats one at a time too, in the plain look`, async ({ page }) => {
    test.slow();
    const conference = await open(page, slug);
    const { config } = conference;
    const formats = formatsOf(conference);
    expect(formats.length).toBeGreaterThan(2);
    await expect(page.locator(".shell")).not.toHaveAttribute("data-dressed");
    await expect(page.locator("[data-dressed]")).toHaveCount(0);
    const here = section(page);

    // What its configuration does not hold is not shown: no sentence, no way to a site.
    if (!config.formatsIntro) await expect(here.locator(".formats-intro")).toHaveCount(0);
    if (!config.website)
      await expect(here.locator(".formats-lead").getByRole("link")).toHaveCount(0);
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    await expect(here.locator(".formats-lead")).toContainText(
      `Proposals in ${new Intl.ListFormat("en", { type: "disjunction" }).format(
        config.languages.map((code) => names.of(code) ?? code),
      )}.`,
    );

    // On a phone: the select, the first format, then each of the others.
    const select = chooser(page);
    await expect(select.locator("option")).toHaveText(
      formats.map((format, i) => `${two(i + 1)} · ${format.name.en}`),
    );
    await expectPanel(page, slug, conference, 0);
    for (const [i, format] of formats.entries()) {
      await select.selectOption(format.key);
      await expectPanel(page, slug, conference, i);
    }
    await panel(page).getByRole("button", { name: "Next", exact: true }).click();
    await expectPanel(page, slug, conference, 0);
    await panel(page).getByRole("button", { name: "Previous", exact: true }).click();
    await expectPanel(page, slug, conference, formats.length - 1);
    await expectAccessible(page);
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoHorizontalScroll(page);
      const smallest = await smallestText(page);
      expect(smallest.size, `“${smallest.text}” at ${width}px`).toBeGreaterThanOrEqual(13);
    }

    // On a wide screen: the list beside the panel, the chosen format marked.
    await page.setViewportSize({ width: 1280, height: 900 });
    const rows = here.getByRole("list", { name: "Format", exact: true }).getByRole("button");
    await expect(rows).toHaveCount(formats.length);
    await expect(here.locator(".format-select")).toBeHidden();
    await expect(rows.last()).toHaveAttribute("aria-current", "true");
    await rows.nth(1).click();
    await expectPanel(page, slug, conference, 1);
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(rows.nth(1)).toBeFocused();
    const [listBox, panelBox] = [
      await here.locator(".format-list").boundingBox(),
      await panel(page).boundingBox(),
    ];
    expect((listBox?.x ?? 0) + (listBox?.width ?? 0)).toBeLessThanOrEqual(panelBox?.x ?? 0);
    const smallest = await smallestText(page);
    expect(smallest.size, `“${smallest.text}”`).toBeGreaterThanOrEqual(13);
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
  });
}
