import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { toPixelRect } from "./overlays";
import { NIGHT_PAGE_FILTER, PHOTO_FILTER } from "./theme";

describe("toPixelRect", () => {
  test("snaps inward to the whole pixels inside the normalised rect", () => {
    expect(toPixelRect({ x: 0.045, y: 0.251, w: 0.515, h: 0.397 }, 1000, 1000)).toEqual({ x: 45, y: 251, w: 515, h: 397 });
    // 10.05..30.05 → pixels 11..30; never past the image edge.
    expect(toPixelRect({ x: 0.1005, y: 0.2, w: 0.2, h: 0.1 }, 100, 50)).toEqual({ x: 11, y: 10, w: 19, h: 5 });
  });

  test("float noise doesn't drop a pixel", () => {
    // (0.1 + 0.2) * 10 = 3.0000000000000004 (start); (0.1 + 0.7) * 10 = 7.999999999999999 (end).
    expect(toPixelRect({ x: 0.1 + 0.2, y: 0, w: 0.2, h: 1 }, 10, 10)).toEqual({ x: 3, y: 0, w: 2, h: 10 });
    expect(toPixelRect({ x: 0.1, y: 0, w: 0.7, h: 1 }, 10, 10)).toEqual({ x: 1, y: 0, w: 7, h: 10 });
  });

  test("clamps to the canvas", () => {
    expect(toPixelRect({ x: -0.1, y: 0.5, w: 1.3, h: 0.6 }, 200, 100)).toEqual({ x: 0, y: 50, w: 200, h: 50 });
  });

  test("returns null for an empty or off-canvas rect", () => {
    expect(toPixelRect({ x: 0.5, y: 0.5, w: 0, h: 0.1 }, 200, 100)).toBeNull();
    expect(toPixelRect({ x: 1.2, y: 0, w: 0.1, h: 1 }, 200, 100)).toBeNull();
    // 10.05..10.45: no whole pixel inside.
    expect(toPixelRect({ x: 0.1005, y: 0, w: 0.004, h: 1 }, 100, 100)).toBeNull();
  });
});

test("app.css night filters match theme.ts", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "src/app.css"), "utf8");
  expect(css).toContain(`[data-theme="night"] .page-base { filter: ${NIGHT_PAGE_FILTER}; }`);
  expect(css).toContain(`[data-theme="night"] .photo-overlay { filter: ${PHOTO_FILTER}; }`);
  expect(css).toContain(`[data-theme="day"] .photo-overlay { display: none; }`);
  expect(css).toContain(`[data-theme="night"][data-images="original"] .figure-overlay { display: block; filter: ${PHOTO_FILTER}; }`);
  expect(css).toContain(`.figure-overlay { position: absolute; display: none; }`);
});
