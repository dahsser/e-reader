import { test, expect, type Locator, type Page } from "@playwright/test";
import { elementPixel, fixture } from "./helpers";

// Tall enough that a whole page (≈ 768 × 994 CSS px) fits in the reader, so
// element screenshots of a page wrapper capture the full page.
test.use({ viewport: { width: 800, height: 1100 } });

type RGB = [number, number, number];

const pageWrapper = (page: Page, index: number) => page.locator(`[data-testid="page"][data-page="${index}"]`);
const imagesButton = (page: Page) => page.getByRole("button", { name: "Original images" });
const nightButton = (page: Page) => page.getByRole("button", { name: "Night view" });

async function open(page: Page, name: "mixed" | "scan", pages: number) {
  await page.goto("/");
  await page.getByTestId("upload-input").setInputFiles(fixture(name));
  await expect(page.getByTestId("page-indicator")).toHaveText(`1 / ${pages}`);
}

/** Scroll page `index` to the top of the reader and wait for its rendered canvas. */
async function showPage(page: Page, index: number): Promise<Locator> {
  const wrapper = pageWrapper(page, index);
  await wrapper.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(wrapper.locator(".page-base")).toHaveCount(1);
  await expect.poll(() => wrapper.locator(".page-base").evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(0);
  return wrapper;
}

async function setNight(page: Page, on: boolean) {
  const button = nightButton(page);
  if ((await button.getAttribute("aria-pressed")) !== String(on)) await button.click();
  await expect(button).toHaveAttribute("aria-pressed", String(on));
  await expect(page.locator("html")).toHaveAttribute("data-theme", on ? "night" : "day");
}

function expectChannelsAtMost(px: RGB, max: number) {
  for (const c of px) expect(c, `pixel ${px.join(",")}`).toBeLessThanOrEqual(max);
}

function storedNight(page: Page): Promise<unknown> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("reader.settings") ?? "null")?.night);
}

test("night page background is charcoal, not white", async ({ page }) => {
  await open(page, "mixed", 4);
  await setNight(page, true);
  const wrapper = await showPage(page, 0);
  await expect(wrapper.locator(".photo-overlay")).toHaveCount(0);
  expectChannelsAtMost(await elementPixel(wrapper, 0.02, 0.02), 45);
});

test("vector diagram keeps its hue", async ({ page }) => {
  await open(page, "mixed", 4);
  const wrapper = await showPage(page, 0);
  // Centre of the red (#e53935) box, located empirically from a day-mode
  // screenshot of page 1 (box spans x ≈ 0.06..0.25, y ≈ 0.24..0.30 of the page).
  const [x, y] = [0.156, 0.272];
  const [dr, dg, db] = await elementPixel(wrapper, x, y);
  expect(dr).toBeGreaterThan(dg + 100); // sanity: the probe really is on the red box
  expect(dr).toBeGreaterThan(db + 100);

  await setNight(page, true);
  const [r, g, b] = await elementPixel(wrapper, x, y);
  expect(r).toBeGreaterThan(g + 30);
  expect(r).toBeGreaterThan(b + 30);
});

test("photo keeps true colours", async ({ page }) => {
  await open(page, "mixed", 4);
  const wrapper = await showPage(page, 1);
  await expect(wrapper.locator(".photo-overlay")).toHaveCount(1);
  // Inside the photo rect (x 0.045 + 0.515 × 0.3, y 0.251 + 0.397 × 0.2): the
  // parrot's red feathers. A smooth area rather than the exact centre (fine
  // feather texture there) so a sub-pixel resampling difference can't decide the test.
  const [x, y] = [0.2, 0.33];
  const day = await elementPixel(wrapper, x, y);

  await setNight(page, true);
  const night = await elementPixel(wrapper, x, y);
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(night[i] - day[i] * 0.85), `day ${day.join(",")} night ${night.join(",")}`).toBeLessThanOrEqual(25);
  }
});

test("white-background raster diagram goes dark", async ({ page }) => {
  await open(page, "mixed", 4);
  await setNight(page, true);
  const wrapper = await showPage(page, 2);
  await expect(wrapper.locator(".photo-overlay")).toHaveCount(0);
  // Just inside the image rect's top-left corner (rect starts at x 0.045, y 0.251): white image background.
  expectChannelsAtMost(await elementPixel(wrapper, 0.06, 0.262), 60);
});

test("transparent line art is transformed (background dark)", async ({ page }) => {
  await open(page, "mixed", 4);
  await setNight(page, true);
  const wrapper = await showPage(page, 3);
  await expect(wrapper.locator(".photo-overlay")).toHaveCount(0);
  // Inside the image rect (x 0.045..0.535, y 0.251..0.631), in the empty grid
  // cell third from the left on the top row (found from a day-mode screenshot).
  expectChannelsAtMost(await elementPixel(wrapper, 0.232, 0.28), 60);
});

test("full-page scan page is dark", async ({ page }) => {
  await open(page, "scan", 2);
  await setNight(page, true);
  const wrapper = await showPage(page, 0);
  await expect(wrapper.locator(".photo-overlay")).toHaveCount(0);
  expectChannelsAtMost(await elementPixel(wrapper, 0.02, 0.02), 60);
  await expect(pageWrapper(page, 1).locator(".photo-overlay")).toHaveCount(0);
});

test("toggle persists across reload and key n toggles", async ({ page }) => {
  await open(page, "mixed", 4);
  await expect(nightButton(page)).toHaveAttribute("aria-pressed", "false");
  await setNight(page, true);
  expect(await storedNight(page)).toBe(true);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await expect(page.getByTestId("page-indicator")).toHaveText("1 / 4");
  await expect(nightButton(page)).toHaveAttribute("aria-pressed", "true");

  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("n");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
  await expect(nightButton(page)).toHaveAttribute("aria-pressed", "false");
  expect(await storedNight(page)).toBe(false);
  await page.keyboard.press("n");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");

  // Ignored while typing in a text field or with modifier keys.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "probe-input";
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press("n");
  await page.keyboard.press("Alt+n");
  await expect(page.locator("#probe-input")).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  expect(await storedNight(page)).toBe(true);
});

test.describe("dark OS preference", () => {
  test.use({ colorScheme: "dark" });

  test("first launch follows the OS and no chrome renders white", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    await expect(nightButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("upload-input")).toBeAttached();
    expectChannelsAtMost(await elementPixel(page.getByRole("toolbar"), 0.5, 0.5), 45);
    expectChannelsAtMost(await elementPixel(page.locator("main"), 0.02, 0.02), 45);

    await page.getByTestId("upload-input").setInputFiles(fixture("mixed"));
    await expect(page.getByTestId("page-indicator")).toHaveText("1 / 4");
    const wrapper = await showPage(page, 0);
    expectChannelsAtMost(await elementPixel(wrapper, 0.02, 0.02), 45);
  });
});

function expectChannelsAtLeast(px: RGB, min: number) {
  for (const c of px) expect(c, `pixel ${px.join(",")}`).toBeGreaterThanOrEqual(min);
}

async function setImages(page: Page, on: boolean) {
  await imagesButton(page).click();
  await expect(imagesButton(page)).toHaveAttribute("aria-pressed", String(on));
  await expect(page.locator("html")).toHaveAttribute("data-images", on ? "original" : "night");
}

test("original-images button only shows in night view", async ({ page }) => {
  await open(page, "mixed", 4);
  await expect(imagesButton(page)).toHaveCount(0);
  await setNight(page, true);
  await expect(imagesButton(page)).toBeVisible();
  await expect(imagesButton(page)).toHaveAttribute("aria-pressed", "false");
});

test("original images show raster diagrams with their white background", async ({ page }) => {
  await open(page, "mixed", 4);
  await setNight(page, true);
  const wrapper = await showPage(page, 2);
  expectChannelsAtMost(await elementPixel(wrapper, 0.06, 0.262), 60);
  await expect(wrapper.locator(".figure-overlay")).toHaveCount(1);
  await setImages(page, true);
  expectChannelsAtLeast(await elementPixel(wrapper, 0.06, 0.262), 180);
  expectChannelsAtMost(await elementPixel(wrapper, 0.02, 0.02), 45);
  await expect(wrapper.locator(".figure-overlay")).toHaveCount(1);
  await setImages(page, false);
  expectChannelsAtMost(await elementPixel(wrapper, 0.06, 0.262), 60);
});

test("original images: transparent line art gets a white background", async ({ page }) => {
  await open(page, "mixed", 4);
  await setNight(page, true);
  const wrapper = await showPage(page, 3);
  await setImages(page, true);
  expectChannelsAtLeast(await elementPixel(wrapper, 0.232, 0.28), 180);
});

test("original images leave full-page scans dark", async ({ page }) => {
  await open(page, "scan", 2);
  await setNight(page, true);
  const wrapper = await showPage(page, 0);
  await setImages(page, true);
  expectChannelsAtMost(await elementPixel(wrapper, 0.02, 0.02), 60);
  await expect(wrapper.locator(".figure-overlay")).toHaveCount(0);
});

test("original images persists across reload and key i toggles", async ({ page }) => {
  await open(page, "mixed", 4);
  await setNight(page, true);
  await setImages(page, true);
  await page.reload();
  await expect(page.getByTestId("page-indicator")).toHaveText("1 / 4");
  await expect(page.locator("html")).toHaveAttribute("data-images", "original");
  await expect(imagesButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("i");
  await expect(page.locator("html")).toHaveAttribute("data-images", "night");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("reader.settings") ?? "null")?.originalImages)).toBe(false);
});
