import type { NormRect } from "./types";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** pdf.js imageCoordinates: 6 numbers per image — top-left, bottom-left, top-right corners (normalised). */
export function rectsFromImageCoordinates(coords: ArrayLike<number> | null): NormRect[] {
  const rects: NormRect[] = [];
  if (!coords) return rects;
  for (let i = 0; i + 5 < coords.length; i += 6) {
    const [x0, y0, x1, y1, x2, y2] = [0, 1, 2, 3, 4, 5].map((k) => coords[i + k]);
    const xs = [x0, x1, x2, x1 + x2 - x0];
    const ys = [y0, y1, y2, y1 + y2 - y0];
    const minX = clamp01(Math.min(...xs));
    const minY = clamp01(Math.min(...ys));
    rects.push({
      x: minX,
      y: minY,
      w: clamp01(Math.max(...xs)) - minX,
      h: clamp01(Math.max(...ys)) - minY,
    });
  }
  return rects;
}
