import { test, expect } from "@playwright/test";

test("app boots without console errors and serves pdf.js assets", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(page.locator("#root")).toBeAttached();
  expect((await request.get("/pdfjs/standard_fonts/FoxitSans.pfb")).ok()).toBe(true);
  expect((await request.get("/pdfjs/wasm/openjpeg.wasm")).ok()).toBe(true);
  expect(errors).toEqual([]);
});

test("night theme is set before first paint", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("reader.settings", JSON.stringify({ night: true, zoom: 1 })));
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("night");
});
