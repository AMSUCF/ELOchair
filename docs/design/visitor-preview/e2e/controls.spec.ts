import { expect, test } from "@playwright/test";

test("preview tools float without changing layout and close with Escape", async ({ page }) => {
  await page.goto("/?lang=both#/home");
  await page.evaluate(() => document.fonts.ready);
  const layout = () =>
    page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      scroll: window.scrollY,
      main: document.querySelector("main")?.getBoundingClientRect().top,
    }));
  const before = await layout();
  const toggle = page.getByRole("button", { name: /^Preview options/ });
  await toggle.click();
  const panel = page.getByRole("dialog", { name: /^Preview options/ });
  await expect(panel).toBeVisible();
  expect(await layout()).toEqual(before);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(toggle).toBeFocused();
  expect(await layout()).toEqual(before);
});

test("format controls and both width buttons work without losing the current format", async ({
  page,
}) => {
  await page.goto("/?lang=both#/guide/papers");
  await page.getByRole("button", { name: /Lightning talks/ }).click();
  await expect(page.getByRole("heading", { name: /Lightning talks/ })).toBeVisible();
  const toggle = page.getByRole("button", { name: /^Preview options/ });
  await toggle.click();
  const panel = page.getByRole("dialog", { name: /^Preview options/ });
  await panel.getByRole("button", { name: /^Mobile/ }).click();
  await expect(panel).toBeVisible();
  expect((await page.locator(".shell").boundingBox())?.width).toBe(360);
  await expect(page.getByRole("heading", { name: /Lightning talks/ })).toBeVisible();
  await expect(page).toHaveURL(/width=mobile.*#\/guide\/lightning$/);
  await panel.getByRole("button", { name: /^Close preview options/ }).click();
  await page.getByRole("combobox", { name: /Format/ }).selectOption("panels");
  await expect(page.getByRole("heading", { name: /Panels/ })).toBeVisible();
  await toggle.click();
  await panel.getByRole("button", { name: /^Desktop/ }).click();
  expect((await page.locator(".shell").boundingBox())?.width).toBeGreaterThan(1000);
  await expect(page.getByRole("heading", { name: /Panels/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Panels/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await panel.getByRole("combobox").selectOption("closed");
  await expect(panel).toBeVisible();
  await expect(page.getByRole("link", { name: /View my proposals/ })).toBeVisible();
  await expect(page).toHaveURL(/state=closed/);
  await page.screenshot({ path: "test-results/preview/desktop-controls.png" });
});

test("the floating controls fit a phone viewport in both languages", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/?lang=both&width=mobile#/home");
  await page.getByRole("button", { name: /^Preview options/ }).click();
  const panel = page.getByRole("dialog", { name: /^Preview options/ });
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.screenshot({ path: "test-results/preview/phone-controls.png" });
});
