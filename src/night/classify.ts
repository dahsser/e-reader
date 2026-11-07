import type { NormRect } from "../engine/types";

export const LIGHT_LUMA = 200;
export const MAX_LIGHT_SHARE = 0.3;
export const MIN_PHOTO_AREA = 0.02;
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

export function isFullPageScan(rects: NormRect[]): boolean {
  return rects.some((r) => r.w * r.h >= FULL_PAGE_SCAN_AREA);
}

export function photoRects(
  rects: NormRect[],
  readPixels: (r: NormRect) => Uint8ClampedArray,
): NormRect[] {
  if (isFullPageScan(rects)) return [];
  return rects.filter(
    (r) => r.w * r.h >= MIN_PHOTO_AREA && lightShare(readPixels(r)) <= MAX_LIGHT_SHARE,
  );
}
