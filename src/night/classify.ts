import type { NormRect } from "../engine/types";

export const LIGHT_LUMA = 200;
export const MAX_LIGHT_SHARE = 0.3;
export const MIN_PHOTO_AREA = 0.02;
export const MIN_FIGURE_AREA = 0.001;
export const FULL_PAGE_SCAN_AREA = 0.85;

/** Share of sampled pixels (every `step`-th) whose luma is >= LIGHT_LUMA. */
export function lightShare(rgba: Uint8ClampedArray, step = 4): number {
  const stride = Math.max(1, Math.floor(step));
  let sampled = 0;
  let light = 0;
  for (let i = 0; i * 4 + 2 < rgba.length; i += stride) {
    const o = i * 4;
    const luma = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
    sampled++;
    if (luma >= LIGHT_LUMA) light++;
  }
  return sampled === 0 ? 0 : light / sampled;
}

const STRIP_SPAN = 0.9;

/**
 * A scan: one image covers the page, or the page is tiled in full-width
 * (or full-height) strips whose summed area covers it. A big photo plus a
 * small one, or two stacked partial images, is not a scan.
 */
export function isFullPageScan(rects: NormRect[]): boolean {
  if (rects.length === 0) return false;
  if (rects.some((r) => r.w * r.h >= FULL_PAGE_SCAN_AREA)) return true;
  const total = rects.reduce((sum, r) => sum + r.w * r.h, 0);
  if (total < FULL_PAGE_SCAN_AREA) return false;
  return rects.every((r) => r.w >= STRIP_SPAN) || rects.every((r) => r.h >= STRIP_SPAN);
}

/**
 * Photos keep their true colours at night always; figures (light or tiny
 * images that the page filter handles) only when the user opts in.
 */
export function classifyImages(
  rects: NormRect[],
  readPixels: (r: NormRect) => Uint8ClampedArray,
): { photos: NormRect[]; figures: NormRect[] } {
  const photos: NormRect[] = [];
  const figures: NormRect[] = [];
  if (isFullPageScan(rects)) return { photos, figures };
  for (const r of rects) {
    const area = r.w * r.h;
    if (area >= MIN_PHOTO_AREA && lightShare(readPixels(r)) <= MAX_LIGHT_SHARE) photos.push(r);
    else if (area >= MIN_FIGURE_AREA) figures.push(r);
  }
  return { photos, figures };
}
