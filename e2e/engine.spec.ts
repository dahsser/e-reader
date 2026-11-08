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

// pdf.js records image positions only on a page's first render and caches them on the page.
test("re-rendering a page (zoom, scroll back) still reports its image rects", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => "__engine" in window);
  const rects = await page.evaluate(async (bytes) => {
    const doc = await window.__engine.open(new Uint8Array(bytes));
    const first = await doc.renderPage(1, document.createElement("canvas"), 1);
    const again = await doc.renderPage(1, document.createElement("canvas"), 2);
    await doc.destroy();
    return [first.imageRects, again.imageRects];
  }, mixed());
  expect(rects[0]).toHaveLength(1);
  expect(rects[1]).toHaveLength(1);
  expect(rects[1][0].x).toBeCloseTo(rects[0][0].x, 3);
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

test("aborting an in-flight render cancels the pdf.js task and rejects with AbortError", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => "__engine" in window);
  const result = await page.evaluate(async (bytes) => {
    const doc = await window.__engine.open(new Uint8Array(bytes));
    await doc.renderPage(1, document.createElement("canvas"), 0.1); // warm the page so getPage resolves fast
    const ctrl = new AbortController();
    const p = doc.renderPage(1, document.createElement("canvas"), 4, ctrl.signal);
    let settled = false;
    p.then(() => (settled = true), () => (settled = true));
    await new Promise((r) => setTimeout(r, 0));
    const abortedBeforeSettled = !settled;
    ctrl.abort();
    try {
      await p;
      return { name: "resolved", abortedBeforeSettled };
    } catch (e) {
      return { name: (e as Error).name, abortedBeforeSettled };
    } finally {
      await doc.destroy();
    }
  }, mixed());
  expect(result.abortedBeforeSettled).toBe(true);
  expect(result.name).toBe("AbortError");
});
