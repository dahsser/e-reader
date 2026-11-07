import type { PageSize } from "../engine/types";

export const PAGE_GAP = 12;
export const MAX_BASE_WIDTH = 1000;
export const MAX_CANVAS_PIXELS = 16_777_216;

/** CSS px, relative to the scroll content. */
export interface PageBox {
  top: number;
  width: number;
  height: number;
}

export function layoutPages(
  sizes: PageSize[],
  containerWidth: number,
  zoom: number,
): { boxes: PageBox[]; totalHeight: number } {
  const width = Math.min(containerWidth - 32, MAX_BASE_WIDTH) * zoom;
  const boxes: PageBox[] = [];
  let top = 0;
  for (const size of sizes) {
    const height = (width * size.height) / size.width;
    boxes.push({ top, width, height });
    top += height + PAGE_GAP;
  }
  const totalHeight = boxes.length ? top - PAGE_GAP : 0;
  return { boxes, totalHeight };
}

const MAX_FRACTION = 0.999;

export function positionAt(scrollTop: number, boxes: PageBox[]): { page: number; fraction: number } {
  if (boxes.length === 0 || scrollTop <= boxes[0].top) return { page: 0, fraction: 0 };
  // Binary search for the last page whose top <= scrollTop.
  let lo = 0;
  let hi = boxes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (boxes[mid].top <= scrollTop) lo = mid;
    else hi = mid - 1;
  }
  const box = boxes[lo];
  const offset = scrollTop - box.top;
  if (offset < box.height) return { page: lo, fraction: offset / box.height };
  // In the gap after page lo, or past the end.
  if (lo + 1 < boxes.length) return { page: lo + 1, fraction: 0 };
  return { page: lo, fraction: Math.min(offset / box.height, MAX_FRACTION) };
}

export function scrollTopFor(pos: { page: number; fraction: number }, boxes: PageBox[]): number {
  if (boxes.length === 0) return 0;
  const box = boxes[Math.min(Math.max(pos.page, 0), boxes.length - 1)];
  return box.top + pos.fraction * box.height;
}

export function renderScale(box: PageBox, size: PageSize, dpr: number): number {
  const base = (box.width * dpr) / size.width;
  const pixels = size.width * base * (size.height * base);
  if (pixels <= MAX_CANVAS_PIXELS) return base;
  let scale = base * Math.sqrt(MAX_CANVAS_PIXELS / pixels);
  // Guard against floating-point overshoot.
  while (size.width * scale * (size.height * scale) > MAX_CANVAS_PIXELS) scale *= 1 - 1e-12;
  return scale;
}
