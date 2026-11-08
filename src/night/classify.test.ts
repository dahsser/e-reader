import { describe, expect, test, vi } from "vitest";
import { MIN_FIGURE_AREA, classifyImages, isFullPageScan, lightShare } from "./classify";

const photoRects = (rects: ReturnType<typeof rect>[], read: () => Uint8ClampedArray) => classifyImages(rects, read).photos;

function solid(pixels: number, r: number, g = r, b = r): Uint8ClampedArray {
  const a = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i++) a.set([r, g, b, 255], i * 4);
  return a;
}

const rect = (w: number, h: number) => ({ x: 0, y: 0, w, h });

describe("night classification", () => {
  test("white background with thin dark lines is not a photo", () => {
    const buf = solid(1000, 255);
    for (let i = 0; i < 50; i++) buf.set([0, 0, 0, 255], i * 4);
    expect(lightShare(buf, 1)).toBeCloseTo(0.95);
    expect(photoRects([rect(0.5, 0.5)], () => buf)).toEqual([]);
  });

  test("colourful mid-tone image is a photo", () => {
    const buf = new Uint8ClampedArray(4000);
    for (let i = 0; i < 1000; i++) {
      buf.set([40 + ((i * 37) % 141), 40 + ((i * 53) % 141), 40 + ((i * 71) % 141), 255], i * 4);
    }
    expect(lightShare(buf)).toBe(0);
    expect(photoRects([rect(0.5, 0.5)], () => buf)).toEqual([rect(0.5, 0.5)]);
  });

  test("dark screenshot keeps true colours", () => {
    const r = rect(0.4, 0.4);
    expect(photoRects([r], () => solid(100, 0x20))).toEqual([r]);
  });

  test("tiny images are never photos", () => {
    const read = vi.fn(() => solid(100, 0x20));
    expect(photoRects([rect(0.1, 0.1)], read)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  test("full-page scan disables overlays", () => {
    const read = vi.fn(() => solid(100, 0x20));
    expect(isFullPageScan([rect(1, 1)])).toBe(true);
    expect(isFullPageScan([rect(0.5, 0.5)])).toBe(false);
    expect(photoRects([rect(1, 1), rect(0.3, 0.3)], read)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  test("full-page scan yields no photos or figures", () => {
    expect(classifyImages([rect(1, 1)], () => solid(100, 255))).toEqual({ photos: [], figures: [] });
  });

  test("tiled scan strips (summed area) count as a full-page scan", () => {
    const strips = [0, 1, 2, 3, 4].map((i) => ({ x: 0, y: i * 0.2, w: 1, h: 0.18 }));
    expect(isFullPageScan(strips)).toBe(true);
    expect(classifyImages(strips, () => solid(100, 255))).toEqual({ photos: [], figures: [] });
  });

  test("scan rule: strips of either orientation, but not a big photo plus a small one", () => {
    const rows = [0, 1, 2, 3, 4].map((i) => ({ x: 0, y: i * 0.2, w: 1, h: 0.18 }));
    const cols = [0, 1, 2, 3, 4].map((i) => ({ x: i * 0.2, y: 0, w: 0.18, h: 1 }));
    expect(isFullPageScan(rows)).toBe(true);
    expect(isFullPageScan(cols)).toBe(true);
    expect(isFullPageScan([{ x: 0, y: 0, w: 1, h: 0.8 }, { x: 0, y: 0.9, w: 0.3, h: 0.2 }])).toBe(false);
    expect(isFullPageScan([{ x: 0, y: 0, w: 0.8, h: 1 }, { x: 0.9, y: 0, w: 0.2, h: 0.3 }])).toBe(false);
    expect(
      isFullPageScan([
        { x: 0, y: 0, w: 0.75, h: 0.6 },
        { x: 0, y: 0.6, w: 0.75, h: 0.56 },
      ]),
    ).toBe(false);
    expect(isFullPageScan([rect(1, 1)])).toBe(true);
  });

  test("dark rect is a photo, light rect a figure, specks are neither", () => {
    expect(MIN_FIGURE_AREA).toBe(0.001);
    const dark = rect(0.2, 0.2);
    const light = rect(0.5, 0.5);
    const speck = rect(0.02, 0.025);
    const r = classifyImages([dark, light, speck], (q) => (q === dark ? solid(100, 0x20) : solid(100, 255)));
    expect(r.photos).toEqual([dark]);
    expect(r.figures).toEqual([light]);
  });

  test("dark rect below photo area but above figure area is a figure", () => {
    const small = rect(0.05, 0.1);
    const read = vi.fn(() => solid(100, 0x20));
    expect(classifyImages([small], read)).toEqual({ photos: [], figures: [small] });
    expect(read).not.toHaveBeenCalled();
  });

  test("lightShare uses luma threshold 200", () => {
    expect(lightShare(solid(10, 200), 1)).toBe(1);
    expect(lightShare(solid(10, 199), 1)).toBe(0);
    expect(lightShare(new Uint8ClampedArray(0))).toBe(0);
  });
});
