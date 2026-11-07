import { describe, expect, test } from "vitest";
import type { PageSize } from "../engine/types";
import { MAX_CANVAS_PIXELS, PAGE_GAP, layoutPages, positionAt, renderScale, scrollTopFor } from "./layout";

const sizes: PageSize[] = Array.from({ length: 6 }, () => ({ width: 612, height: 792 }));

describe("layout", () => {
  test("layoutPages stacks pages with gaps and per-page aspect", () => {
    const { boxes, totalHeight } = layoutPages(
      [{ width: 612, height: 792 }, { width: 792, height: 612 }],
      1032,
      1,
    );
    expect(boxes[0].width).toBe(1000);
    expect(boxes[1].width).toBe(1000);
    expect(boxes[0].top).toBe(0);
    expect(boxes[0].height).toBeCloseTo(1294.12, 1);
    expect(boxes[1].top).toBeCloseTo(boxes[0].height + PAGE_GAP, 5);
    expect(boxes[1].height).toBeCloseTo(772.73, 1);
    expect(totalHeight).toBeCloseTo(boxes[1].top + boxes[1].height, 5);
  });

  test("layoutPages caps base width and applies zoom", () => {
    const narrow = layoutPages(sizes.slice(0, 1), 432, 2);
    expect(narrow.boxes[0].width).toBe(800);
    const wide = layoutPages(sizes.slice(0, 1), 5000, 1.5);
    expect(wide.boxes[0].width).toBe(1500);
    expect(layoutPages([], 800, 1)).toEqual({ boxes: [], totalHeight: 0 });
  });

  test("positionAt / scrollTopFor round-trip", () => {
    const { boxes } = layoutPages(sizes, 1032, 1);
    const st = scrollTopFor({ page: 3, fraction: 0.25 }, boxes);
    const p = positionAt(st, boxes);
    expect(p.page).toBe(3);
    expect(p.fraction).toBeCloseTo(0.25, 6);
  });

  test("positionAt inside a gap belongs to the next page with fraction 0", () => {
    const { boxes } = layoutPages(sizes, 1032, 1);
    const inGap = boxes[1].top + boxes[1].height + PAGE_GAP / 2;
    expect(positionAt(inGap, boxes)).toEqual({ page: 2, fraction: 0 });
  });

  test("positionAt clamps above the first page and past the end", () => {
    const { boxes, totalHeight } = layoutPages(sizes, 1032, 1);
    expect(positionAt(-50, boxes)).toEqual({ page: 0, fraction: 0 });
    const end = positionAt(totalHeight + 500, boxes);
    expect(end.page).toBe(5);
    expect(end.fraction).toBeLessThan(1);
    expect(positionAt(0, [])).toEqual({ page: 0, fraction: 0 });
  });

  test("scrollTopFor clamps the page index", () => {
    const { boxes } = layoutPages(sizes, 1032, 1);
    expect(scrollTopFor({ page: 99, fraction: 0 }, boxes)).toBe(boxes[5].top);
    expect(scrollTopFor({ page: -1, fraction: 0 }, boxes)).toBe(0);
    expect(scrollTopFor({ page: 0, fraction: 0 }, [])).toBe(0);
  });

  test("position survives a zoom change", () => {
    const pos = { page: 4, fraction: 0.6 };
    const a = layoutPages(sizes, 1032, 1).boxes;
    const b = layoutPages(sizes, 1032, 2.5).boxes;
    const sa = scrollTopFor(pos, a);
    const sb = scrollTopFor(pos, b);
    expect(sb).not.toBe(sa);
    for (const [st, boxes] of [[sa, a], [sb, b]] as const) {
      const p = positionAt(st, boxes);
      expect(p.page).toBe(pos.page);
      expect(p.fraction).toBeCloseTo(pos.fraction, 6);
    }
  });

  test("renderScale is box.width*dpr/size.width when small", () => {
    const size = { width: 612, height: 792 };
    expect(renderScale({ top: 0, width: 612, height: 792 }, size, 2)).toBeCloseTo(2, 9);
  });

  test("renderScale caps huge canvases", () => {
    const size = { width: 612, height: 792 };
    const { boxes } = layoutPages([size], 1032, 3);
    const s = renderScale(boxes[0], size, 2);
    expect(s).toBeLessThan((boxes[0].width * 2) / size.width);
    expect(size.width * s * (size.height * s)).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(size.width * s * (size.height * s)).toBeGreaterThan(MAX_CANVAS_PIXELS * 0.999);
  });
});
