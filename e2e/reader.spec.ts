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
  await page.getByRole("button", { name: "Shelf", exact: true }).click();
  await page.getByTestId("shelf-upload").setInputFiles(fixture("long"));
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
