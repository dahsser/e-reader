import { test, expect } from "vitest";
import { rectsFromImageCoordinates } from "./rects";

test("converts three-corner records to axis-aligned rects", () => {
  // top-left, bottom-left, top-right — as returned by pdf.js 6.5 imageCoordinates
  expect(rectsFromImageCoordinates([0.045, 0.251, 0.045, 0.648, 0.56, 0.251]))
    .toEqual([{ x: 0.045, y: 0.251, w: expect.closeTo(0.515, 5), h: expect.closeTo(0.397, 5) }]);
});
test("handles multiple images, rotated records and null", () => {
  expect(rectsFromImageCoordinates(null)).toEqual([]);
  expect(rectsFromImageCoordinates([0,0,0,1,1,0, 0.5,0.5,0.5,0.6,0.7,0.5])).toHaveLength(2);
  // rotated 90°: bbox must include the implied 4th corner (p1 + p2 - p0)
  const [r] = rectsFromImageCoordinates([0.2, 0.2, 0.4, 0.2, 0.2, 0.5]);
  expect(r).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.2, 5), h: expect.closeTo(0.3, 5) });
});
