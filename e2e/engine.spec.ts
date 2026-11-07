import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { fixture } from "./helpers";

const mixed = () => [...fs.readFileSync(fixture("mixed"))];

test("opens mixed.pdf, reports sizes, title fallback and image rects", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => "__engine" in window);
  const result = await page.evaluate(async (bytes) => {
    const doc = await window.__engine.open(new Uint8Array(bytes));
    const sizes = await doc.getPageSizes();
    const title = await doc.getTitle();
    const canvas = document.createElement("canvas");
    const page1 = await doc.renderPage(0, canvas, 1);
    const page2 = await doc.renderPage(1, canvas, 1);
    const thumb = await doc.renderThumbnail(120);
    const out = { numPages: doc.numPages, sizes, title, page1Rects: page1.imageRects, page2Rects: page2.imageRects, thumbType: thumb.type, thumbSize: thumb.size };
    await doc.destroy();
    return out;
  }, mixed());
  expect(result.numPages).toBe(4);
  expect(result.sizes).toHaveLength(4);
  expect(result.sizes[0]).toEqual({ width: 612, height: 792 });
  expect(result.title === null || typeof result.title === "string").toBe(true);
  expect(result.page2Rects).toHaveLength(1);
  expect(result.page2Rects[0].x).toBeCloseTo(0.045, 2);
  expect(result.page1Rects).toEqual([]);
  expect(result.thumbType).toBe("image/webp");
  expect(result.thumbSize).toBeGreaterThan(0);
});

test("rejects garbage bytes with PdfOpenError", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => "__engine" in window);
  const name = await page.evaluate(async () => {
    try {
      await window.__engine.open(new Uint8Array([1, 2, 3, 4, 5]));
      return "resolved";
    } catch (e) {
      return (e as Error).name;
    }
  });
  expect(name).toBe("PdfOpenError");
});

test("aborting a render rejects with AbortError", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => "__engine" in window);
  const name = await page.evaluate(async (bytes) => {
    const doc = await window.__engine.open(new Uint8Array(bytes));
    const ctrl = new AbortController();
    const p = doc.renderPage(1, document.createElement("canvas"), 2, ctrl.signal);
    ctrl.abort();
    try {
      await p;
      return "resolved";
    } catch (e) {
      return (e as Error).name;
    } finally {
      await doc.destroy();
    }
  }, mixed());
  expect(name).toBe("AbortError");
});
