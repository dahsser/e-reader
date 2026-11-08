import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./helpers";

const indicator = (page: Page) => page.getByTestId("page-indicator");
const uploadInput = (page: Page) => page.getByTestId("upload-input");
const pageWrapper = (page: Page, index: number) => page.locator(`[data-testid="page"][data-page="${index}"]`);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function openLong(page: Page) {
  await page.goto("/");
  await uploadInput(page).setInputFiles(fixture("long"));
  await expect(indicator(page)).toHaveText("1 / 40");
}

/** Scroll the reader's scroll container so page `index` sits at the top of the view. */
async function scrollToPage(page: Page, index: number) {
  await pageWrapper(page, index).evaluate((el) => el.scrollIntoView({ block: "start" }));
}

function canvasWidth(page: Page, index: number): Promise<number> {
  return page.evaluate((i) => {
    const c = document.querySelector<HTMLCanvasElement>(`[data-page="${i}"] .page-base`);
    return c ? c.width : 0;
  }, index);
}

/** Raw IndexedDB access (same DB the app uses), for asserting what was stored. */
function bookCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open("pdf-reader");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const count = db.transaction("books").objectStore("books").count();
          count.onsuccess = () => {
            resolve(count.result);
            db.close();
          };
          count.onerror = () => reject(count.error);
        };
      }),
  );
}

test("first launch shows upload; uploading opens the book at page 1", async ({ page }) => {
  await page.goto("/");
  await expect(uploadInput(page)).toBeAttached();
  await expect(page.getByRole("toolbar")).toBeVisible();
  await uploadInput(page).setInputFiles(fixture("long"));
  await expect(indicator(page)).toHaveText("1 / 40");
  await expect(page.getByTestId("page")).toHaveCount(40);
});

test("reload resumes at the same page", async ({ page }) => {
  await openLong(page);
  await scrollToPage(page, 9);
  await expect(indicator(page)).toHaveText("10 / 40");
  await page.waitForTimeout(600);
  await page.reload();
  await expect(indicator(page)).toHaveText("10 / 40");
});

test("zoom keeps the reading position", async ({ page }) => {
  await openLong(page);
  await scrollToPage(page, 9);
  await expect(indicator(page)).toHaveText("10 / 40");
  const before = (await pageWrapper(page, 9).boundingBox())!.width;

  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();

  await expect.poll(async () => (await pageWrapper(page, 9).boundingBox())!.width).toBeGreaterThan(before * 1.15);
  await expect(indicator(page)).toHaveText("10 / 40");
  // Page 10 still straddles the top edge of the scroll container.
  const main = (await page.locator("main").boundingBox())!;
  const box = (await pageWrapper(page, 9).boundingBox())!;
  expect(box.y).toBeLessThanOrEqual(main.y + 20);
  expect(box.y + box.height).toBeGreaterThan(main.y);
});

test("pinch / Ctrl+wheel zooms smoothly around the pointer without blanking pages", async ({ page }) => {
  await openLong(page);
  await scrollToPage(page, 9);
  await expect.poll(() => canvasWidth(page, 9)).toBeGreaterThan(0);
  const renderedWidth = await canvasWidth(page, 9);
  const before = (await pageWrapper(page, 9).boundingBox())!;
  // A point inside page 10, off-centre. (Horizontally the anchor only holds as far as the
  // scroll range allows: at 128% the page is barely wider than the view.)
  const px = before.x + before.width * 0.45;
  const py = before.y + 120;
  const fx = (px - before.x) / before.width;
  const fy = (py - before.y) / before.height;

  await page.mouse.move(px, py);
  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -5); // trackpad-pinch-sized deltas
  await page.keyboard.up("Control");

  // Continuous: exp(0.25) ≈ 128%, not a 10% step.
  await expect(page.locator(".zoom-level")).toHaveText("128%");
  // The old canvas is kept (stretched) while the sharp one renders.
  expect(await canvasWidth(page, 9)).toBeGreaterThan(0);
  const after = (await pageWrapper(page, 9).boundingBox())!;
  expect(after.width).toBeCloseTo(before.width * 1.28, 0);
  // The content point stays under the pointer.
  expect(after.x + fx * after.width).toBeCloseTo(px, 0);
  expect(after.y + fy * after.height).toBeCloseTo(py, 0);
  // Once the gesture settles the page is re-rendered sharp.
  await expect.poll(() => canvasWidth(page, 9)).toBeGreaterThan(renderedWidth * 1.2);
});

test("zoom buttons step to the next 10% mark after a pinch", async ({ page }) => {
  await openLong(page);
  await page.mouse.move(300, 300);
  await page.keyboard.down("Control");
  for (let i = 0; i < 2; i++) await page.mouse.wheel(0, -5);
  await page.keyboard.up("Control");
  await expect(page.locator(".zoom-level")).toHaveText("111%"); // exp(0.1)
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -3);
  await page.keyboard.up("Control");
  await expect(page.locator(".zoom-level")).toHaveText("114%");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator(".zoom-level")).toHaveText("120%");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(page.locator(".zoom-level")).toHaveText("110%");
});

test("visible pages get rendered canvases", async ({ page }) => {
  await openLong(page);
  await expect.poll(() => canvasWidth(page, 0)).toBeGreaterThan(0);
});

test("cancels renders for pages that left the zone", async ({ page }) => {
  const errors = collectErrors(page);
  await openLong(page);
  await page.locator("main").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => canvasWidth(page, 39)).toBeGreaterThan(0);
  // Pages far above the view are evicted (no canvas kept).
  await expect(pageWrapper(page, 0).locator(".page-base")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("rejects a non-PDF upload", async ({ page }) => {
  await page.goto("/");
  await uploadInput(page).setInputFiles({ name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("hello") });
  await expect(page.getByRole("alert")).toContainText("Couldn't open this file as a PDF");
  await expect(uploadInput(page)).toBeAttached();
  await expect(indicator(page)).toHaveCount(0);
  expect(await bookCount(page)).toBe(0);
});

/** Forget the last-open book (the kv entry startup reads), leaving the shelf as it is. */
function clearLastBookId(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("pdf-reader");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").delete("lastBookId");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test("re-uploading the same file opens it instead of duplicating", async ({ page }) => {
  await openLong(page);
  await scrollToPage(page, 9);
  await expect(indicator(page)).toHaveText("10 / 40");
  await page.waitForTimeout(600);

  // Switch to another book, then upload long again.
  await page.getByRole("button", { name: "Shelf", exact: true }).click();
  await page.getByTestId("shelf-upload").setInputFiles(fixture("mixed"));
  await expect(indicator(page)).toHaveText("1 / 4");
  await page.getByTestId("shelf-upload").setInputFiles(fixture("long")); // the panel stays open
  await expect(indicator(page)).toHaveText("10 / 40");
  expect(await bookCount(page)).toBe(2);
});

test("with no last book recorded, startup opens the shelf's first book instead of the empty state", async ({ page }) => {
  await openLong(page);
  await scrollToPage(page, 9);
  await expect(indicator(page)).toHaveText("10 / 40");
  await page.waitForTimeout(600);

  await clearLastBookId(page);
  await page.reload();
  await expect(indicator(page)).toHaveText("10 / 40");
  await expect(uploadInput(page)).toHaveCount(0);
});

type PositionWriteFlags = { __failPositionWrites?: boolean; __positionWriteFailures?: number };

/** Lets a test make writes to the positions store fail (as a quota/IO error would). */
function allowPositionWriteFailure(page: Page) {
  return page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
      const w = window as PositionWriteFlags;
      if (w.__failPositionWrites && this.name === "positions") {
        w.__positionWriteFailures = (w.__positionWriteFailures ?? 0) + 1;
        throw new DOMException("Injected write failure", "QuotaExceededError");
      }
      return original.apply(this, args);
    } as typeof original;
  });
}
const setPositionWritesFail = (page: Page, fail: boolean) =>
  page.evaluate((f) => ((window as PositionWriteFlags).__failPositionWrites = f), fail);
const positionWriteFailures = (page: Page) =>
  page.evaluate(() => (window as PositionWriteFlags).__positionWriteFailures ?? 0);

/** The stored position's page index for the only book, or null. */
function storedPage(page: Page): Promise<number | null> {
  return page.evaluate(
    () =>
      new Promise<number | null>((resolve, reject) => {
        const req = indexedDB.open("pdf-reader");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const all = db.transaction("positions").objectStore("positions").getAll();
          all.onsuccess = () => {
            db.close();
            const rows = all.result as { page: number; fraction: number }[];
            resolve(rows.length ? Math.round(rows[0].page + rows[0].fraction) : null);
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );
}

test("a failed position save is reported once and retried", async ({ page }) => {
  await allowPositionWriteFailure(page);
  await openLong(page);
  await setPositionWritesFail(page, true);

  await scrollToPage(page, 9);
  await expect(indicator(page)).toHaveText("10 / 40");
  await expect(page.getByRole("alert")).toContainText("Couldn't save your reading position: Injected write failure");
  await page.getByRole("alert").getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Another failing save isn't reported again.
  const failures = await positionWriteFailures(page);
  await scrollToPage(page, 14);
  await expect(indicator(page)).toHaveText("15 / 40");
  await expect.poll(() => positionWriteFailures(page)).toBeGreaterThan(failures);
  await page.waitForTimeout(300);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await storedPage(page)).toBeNull();

  // With storage working again, the unsaved position is written on pagehide, without scrolling.
  await setPositionWritesFail(page, false);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => storedPage(page)).toBe(14);
  await page.reload();
  await expect(indicator(page)).toHaveText("15 / 40");
});

const pageInput = (page: Page) => page.getByTestId("page-input");

async function goTo(page: Page, text: string) {
  await indicator(page).click();
  await pageInput(page).fill(text);
  await pageInput(page).press("Enter");
}

test("go to page: typing a number and Enter jumps to that page", async ({ page }) => {
  await openLong(page);
  await indicator(page).click();
  await expect(pageInput(page)).toBeFocused();
  await expect(pageInput(page)).toHaveValue("1");
  expect(await pageInput(page).evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 1]);
  await pageInput(page).fill("25");
  await pageInput(page).press("Enter");
  await expect(indicator(page)).toHaveText("25 / 40");
  const mainTop = (await page.locator("main").boundingBox())!.y;
  const pageTop = (await pageWrapper(page, 24).boundingBox())!.y;
  expect(Math.abs(pageTop - (mainTop + 16))).toBeLessThan(20);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(indicator(page)).toHaveText("25 / 40");
});

test("go to page clamps out-of-range numbers", async ({ page }) => {
  await openLong(page);
  await goTo(page, "900");
  await expect.poll(async () => Number((await indicator(page).innerText()).split(" / ")[0])).toBeGreaterThanOrEqual(39);
  await expect(pageWrapper(page, 39)).toBeInViewport();
  await goTo(page, "0");
  await expect(indicator(page)).toHaveText("1 / 40");
});

test("go to page: Escape, blur and non-numbers cancel", async ({ page }) => {
  await openLong(page);
  await indicator(page).click();
  await pageInput(page).fill("12");
  await pageInput(page).press("Escape");
  await expect(indicator(page)).toHaveText("1 / 40");
  await expect(pageInput(page)).toHaveCount(0);

  await indicator(page).click();
  await pageInput(page).fill("12");
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await expect(indicator(page)).toHaveText("1 / 40");
  await expect(pageInput(page)).toHaveCount(0);

  await goTo(page, "abc");
  await expect(indicator(page)).toHaveText("1 / 40");
  await expect(pageInput(page)).toHaveCount(0);
});

test("typing in the page input doesn't trigger shortcuts", async ({ page }) => {
  await openLong(page);
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const before = await theme();
  await indicator(page).click();
  await page.keyboard.type("n");
  expect(await theme()).toBe(before);
});

test("zoom after a jump keeps the place", async ({ page }) => {
  await openLong(page);
  await goTo(page, "25");
  await expect(indicator(page)).toHaveText("25 / 40");
  await scrollToPage(page, 27);
  await expect(indicator(page)).toHaveText("28 / 40");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(300);
  await expect(indicator(page)).toHaveText("28 / 40");
});

test("a jump doesn't leak into the next book opened", async ({ page }) => {
  await page.goto("/");
  await uploadInput(page).setInputFiles(fixture("mixed"));
  await expect(indicator(page)).toHaveText("1 / 4");
  await page.getByRole("button", { name: "Shelf", exact: true }).click();
  const shelf = page.getByRole("dialog", { name: "Shelf" });
  await shelf.getByTestId("shelf-upload").setInputFiles(fixture("long"));
  await expect(indicator(page)).toHaveText("1 / 40");
  await page.keyboard.press("Escape");
  await goTo(page, "25");
  await expect(indicator(page)).toHaveText("25 / 40");
  await page.getByRole("button", { name: "Shelf", exact: true }).click();
  await shelf.getByTestId("shelf-book").filter({ hasText: "mixed" }).click();
  await expect(indicator(page)).toHaveText("1 / 4");
});

test("keyboard scrolling works right after a jump", async ({ page }) => {
  await openLong(page);
  await goTo(page, "10");
  await expect(indicator(page)).toHaveText("10 / 40");
  for (let i = 0; i < 4; i++) await page.keyboard.press("PageDown"); // a page is taller than one screen
  await expect.poll(async () => Number((await indicator(page).innerText()).split(" / ")[0])).toBeGreaterThan(10);
});
