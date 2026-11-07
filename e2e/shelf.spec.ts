import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./helpers";

type Name = "mixed" | "scan" | "long";
const PAGES: Record<Name, number> = { mixed: 4, scan: 2, long: 40 };

const size = (name: Name) => statSync(fixture(name)).size;
const sha256 = (name: Name) => createHash("sha256").update(readFileSync(fixture(name))).digest("hex");

const indicator = (page: Page) => page.getByTestId("page-indicator");
const shelfButton = (page: Page) => page.getByRole("button", { name: "Shelf", exact: true });
const shelf = (page: Page) => page.getByRole("dialog", { name: "Shelf" });
const cleanup = (page: Page) => page.getByRole("dialog", { name: "Make room" });
const shelfBooks = (page: Page) => shelf(page).getByTestId("shelf-book");
const confirmButton = (page: Page) => cleanup(page).getByRole("button", { name: "Remove selected and add" });

async function expectOpen(page: Page, name: Name, at = 1) {
  await expect(indicator(page)).toHaveText(`${at} / ${PAGES[name]}`);
}

/** First upload, from the empty state. */
async function uploadFirst(page: Page, name: Name) {
  await page.getByTestId("upload-input").setInputFiles(fixture(name));
  await expectOpen(page, name);
}

async function openShelf(page: Page) {
  await shelfButton(page).click();
  await expect(shelf(page)).toBeVisible();
}

/** Upload from the shelf; a book that fits opens and the shelf closes. */
async function uploadFromShelf(page: Page, name: Name) {
  await openShelf(page);
  await shelf(page).getByTestId("shelf-upload").setInputFiles(fixture(name));
  await expectOpen(page, name);
  await expect(shelf(page)).toHaveCount(0);
}

/** Library sized so mixed + long fit with 1000 bytes to spare. */
const tightCap = () => `/?capBytes=${size("mixed") + size("long") + 1000}`;

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

test("shelf shows usage against 500 MB and books in recent order", async ({ page }) => {
  await page.goto("/");
  await uploadFirst(page, "long");
  await uploadFromShelf(page, "mixed");

  await openShelf(page);
  await expect(shelf(page).getByTestId("usage")).toHaveText(/^\d+ MB of 500 MB$/);
  await expect(shelf(page).getByRole("progressbar")).toBeVisible();
  await expect(shelfBooks(page)).toHaveCount(2);
  await expect(shelfBooks(page).nth(0)).toContainText("mixed.pdf");
  await expect(shelfBooks(page).nth(1)).toContainText("long.pdf");
  await expect(shelfBooks(page).nth(0)).toContainText("%");
  await expect(shelfBooks(page).nth(0).locator("img")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(shelf(page)).toHaveCount(0);
});

test("opening a book from the shelf resumes its position", async ({ page }) => {
  await page.goto("/");
  await uploadFirst(page, "long");
  await page.locator('[data-testid="page"][data-page="9"]').evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expectOpen(page, "long", 10);
  await page.waitForTimeout(600);

  await uploadFromShelf(page, "mixed");
  await openShelf(page);
  await shelfBooks(page).filter({ hasText: "long.pdf" }).click();
  await expectOpen(page, "long", 10);
  await expect(shelf(page)).toHaveCount(0);
});

test("full shelf opens clean-up ordered least read first", async ({ page }) => {
  await page.goto(tightCap());
  await uploadFirst(page, "mixed");
  await uploadFromShelf(page, "long");

  await openShelf(page);
  await shelf(page).getByTestId("shelf-upload").setInputFiles(fixture("scan"));
  await expect(cleanup(page)).toBeVisible();
  await expect(cleanup(page).getByRole("heading")).toHaveText("Need 1 MB more to add “scan.pdf”");

  const rows = cleanup(page).getByRole("checkbox");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("mixed.pdf");
  await expect(rows.nth(1)).toContainText("long.pdf");
  await expect(cleanup(page).getByTestId("cleanup-status")).toHaveText("Selected frees 0 MB — still need 1 MB");
  await expect(confirmButton(page)).toBeDisabled();

  await rows.nth(0).click();
  await expect(rows.nth(0)).toHaveAttribute("aria-checked", "true");
  await expect(cleanup(page).getByTestId("cleanup-status")).toHaveText("Enough space");
  await expect(confirmButton(page)).toBeEnabled();

  await confirmButton(page).click();
  await expectOpen(page, "scan");
  await expect(cleanup(page)).toHaveCount(0);
  await expect(shelf(page)).toHaveCount(0);

  await openShelf(page);
  await expect(shelfBooks(page)).toHaveCount(2);
  await expect(shelfBooks(page).nth(0)).toContainText("scan.pdf");
  await expect(shelfBooks(page).nth(1)).toContainText("long.pdf");
});

/**
 * Lets a test make the next book write to OPFS fail (as a quota/IO error would), so a
 * clean-up retry fails *after* the selected books were removed.
 */
function allowWriteFailure(page: Page) {
  return page.addInitScript(() => {
    const original = FileSystemWritableFileStream.prototype.write;
    FileSystemWritableFileStream.prototype.write = function (this: FileSystemWritableFileStream, ...args) {
      if ((window as { __failBookWrites?: boolean }).__failBookWrites) {
        return Promise.reject(new DOMException("Injected write failure", "QuotaExceededError"));
      }
      return original.apply(this, args);
    } as typeof original;
  });
}
const failNextWrites = (page: Page) => page.evaluate(() => ((window as { __failBookWrites?: boolean }).__failBookWrites = true));

test("removing the open book opens the next one", async ({ page }) => {
  await allowWriteFailure(page);
  await page.goto(tightCap());
  await uploadFirst(page, "long");
  await uploadFromShelf(page, "mixed"); // mixed is open; long is least read

  await openShelf(page);
  await shelf(page).getByTestId("shelf-upload").setInputFiles(fixture("scan"));
  await expect(cleanup(page)).toBeVisible();
  const mixedRow = cleanup(page).getByRole("checkbox").filter({ hasText: "mixed.pdf" });
  await mixedRow.click();
  await expect(cleanup(page).getByTestId("cleanup-status")).toHaveText("Enough space");
  // The retry fails to store scan, so no new book takes over from the removed one.
  await failNextWrites(page);
  await confirmButton(page).click();

  await expect(page.getByRole("alert")).toContainText("Couldn't save this book");
  await expectOpen(page, "long");
  await expect(cleanup(page)).toHaveCount(0);
  await openShelf(page);
  await expect(shelfBooks(page)).toHaveCount(1);
  await expect(shelfBooks(page).nth(0)).toContainText("long.pdf");
});

test("removing the only book shows the empty state", async ({ page }) => {
  await allowWriteFailure(page);
  await page.goto(`/?capBytes=${size("long") + 1000}`);
  await uploadFirst(page, "long");

  await openShelf(page);
  await shelf(page).getByTestId("shelf-upload").setInputFiles(fixture("scan"));
  await cleanup(page).getByRole("checkbox").first().click();
  await failNextWrites(page);
  await confirmButton(page).click();

  await expect(page.getByRole("alert")).toContainText("Couldn't save this book");
  await expect(page.getByTestId("upload-input")).toBeAttached();
  await expect(indicator(page)).toHaveCount(0);
  expect(await bookCount(page)).toBe(0);
});

test("a file that isn't a PDF never opens clean-up, even when the shelf is full", async ({ page }) => {
  await page.goto(tightCap());
  await uploadFirst(page, "long");
  await uploadFromShelf(page, "mixed");

  await openShelf(page);
  await shelf(page)
    .getByTestId("shelf-upload")
    .setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(size("mixed"), 7) });

  await expect(page.getByRole("alert")).toContainText("Couldn't open this file as a PDF");
  await expect(cleanup(page)).toHaveCount(0);
  await expectOpen(page, "mixed");
  expect(await bookCount(page)).toBe(2);
});

test("cancel leaves everything as it was", async ({ page }) => {
  await page.goto(tightCap());
  await uploadFirst(page, "mixed");
  await uploadFromShelf(page, "long");

  await openShelf(page);
  const usageBefore = await shelf(page).getByTestId("usage").textContent();
  await shelf(page).getByTestId("shelf-upload").setInputFiles(fixture("scan"));
  await expect(cleanup(page)).toBeVisible();
  await cleanup(page).getByRole("checkbox").first().click();
  await cleanup(page).getByRole("button", { name: "Cancel" }).click();

  await expect(cleanup(page)).toHaveCount(0);
  await expect(shelf(page)).toBeVisible();
  await expect(shelfBooks(page)).toHaveCount(2);
  await expect(shelf(page).getByTestId("usage")).toHaveText(usageBefore!);
  await expectOpen(page, "long");
  expect(await bookCount(page)).toBe(2);

  // Escape closes only the topmost dialog.
  await shelf(page).getByTestId("shelf-upload").setInputFiles(fixture("scan"));
  await expect(cleanup(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cleanup(page)).toHaveCount(0);
  await expect(shelf(page)).toBeVisible();

  await page.reload();
  await expectOpen(page, "long");
  expect(await bookCount(page)).toBe(2);
});

test("a book that fails to open falls back to the next one and stays on the shelf", async ({ page }) => {
  await page.goto("/");
  await uploadFirst(page, "long");
  await uploadFromShelf(page, "mixed"); // mixed becomes the startup book

  // Corrupt mixed's stored bytes.
  await page.evaluate(async (id) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("books");
    const writable = await (await dir.getFileHandle(id)).createWritable();
    await writable.write(new TextEncoder().encode("not a pdf any more"));
    await writable.close();
  }, sha256("mixed"));

  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Couldn't open this book");
  await expectOpen(page, "long");
  await openShelf(page);
  await expect(shelfBooks(page)).toHaveCount(2);
  await expect(shelf(page)).toContainText("mixed.pdf");

  await page.reload();
  await expectOpen(page, "long");
});

test("dialogs use the night theme, not white", async ({ page }) => {
  await page.goto(tightCap());
  await uploadFirst(page, "mixed");
  await uploadFromShelf(page, "long");
  await page.getByRole("button", { name: "Night view" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");

  const background = (dialog: ReturnType<typeof shelf>) =>
    dialog.evaluate((el) => getComputedStyle(el).backgroundColor);
  await openShelf(page);
  expect(await background(shelf(page))).toBe("rgb(27, 26, 24)"); // --chrome-bg at night
  await shelf(page).getByTestId("shelf-upload").setInputFiles(fixture("scan"));
  await expect(cleanup(page)).toBeVisible();
  expect(await background(cleanup(page))).toBe("rgb(27, 26, 24)");
});

const PERSIST_NOTICE = "Your browser may clear stored books if the disk gets full.";

function stubPersistence(page: Page, granted: boolean) {
  return page.addInitScript((g) => {
    navigator.storage.persist = async () => g;
    navigator.storage.persisted = async () => g;
  }, granted);
}

test("persistence notice shows once when storage is not persisted", async ({ page }) => {
  await stubPersistence(page, false);
  await page.goto("/");
  await uploadFirst(page, "long");
  await expect(page.getByText(PERSIST_NOTICE)).toBeVisible();

  await page.reload();
  await expectOpen(page, "long");
  await expect(page.getByText(PERSIST_NOTICE)).toBeVisible();

  await page.getByRole("button", { name: "Dismiss notice" }).click();
  await expect(page.getByText(PERSIST_NOTICE)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("reader.persistNoticeDismissed"))).toBe("1");

  await page.reload();
  await expectOpen(page, "long");
  await page.waitForTimeout(300);
  await expect(page.getByText(PERSIST_NOTICE)).toHaveCount(0);
});

test("no persistence notice when storage is persisted", async ({ page }) => {
  await stubPersistence(page, true);
  await page.goto("/");
  await uploadFirst(page, "long");
  await page.waitForTimeout(300);
  await expect(page.getByText(PERSIST_NOTICE)).toHaveCount(0);
});
