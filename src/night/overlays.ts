import type { NormRect } from "../engine/types";
import { classifyImages } from "./classify";

export interface PixelRect { x: number; y: number; w: number; h: number }

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
/** Absorbs float noise (e.g. (0.1 + 0.2) * 10 = 3.0000000000000004) so it doesn't drop a pixel. */
const EPS = 1e-6;

/**
 * Whole pixels inside `r` (normalised 0..1) on a `width` × `height` canvas; null if empty.
 * Snaps inward so an overlay never extends past its image (at night that would leave a
 * ring of unfiltered light page around the photo).
 */
export function toPixelRect(r: NormRect, width: number, height: number): PixelRect | null {
  const x0 = clamp(Math.ceil(r.x * width - EPS), width);
  const y0 = clamp(Math.ceil(r.y * height - EPS), height);
  const x1 = clamp(Math.floor((r.x + r.w) * width + EPS), width);
  const y1 = clamp(Math.floor((r.y + r.h) * height + EPS), height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * One overlay canvas per image on `base` (`photo-overlay` for photos,
 * `figure-overlay` for figures), copied pixel-for-pixel from the (unfiltered) base render and
 * positioned in % of the page box. Night CSS filters the base but only dims
 * the overlays, so photos keep their true colours; figure overlays show only
 * with the original-images toggle. Built regardless of the current settings
 * so toggling is instant; CSS hides them.
 */
export function createImageOverlays(base: HTMLCanvasElement, imageRects: NormRect[]): HTMLCanvasElement[] {
  const { width, height } = base;
  if (width === 0 || height === 0 || imageRects.length === 0) return [];
  try {
    const ctx = base.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    const empty = new Uint8ClampedArray(0);
    const { photos, figures } = classifyImages(imageRects, (r) => {
      const p = toPixelRect(r, width, height);
      return p ? ctx.getImageData(p.x, p.y, p.w, p.h).data : empty;
    });
    const overlays: HTMLCanvasElement[] = [];
    const kinds: [NormRect[], string][] = [[photos, "photo-overlay"], [figures, "figure-overlay"]];
    for (const [rects, className] of kinds) for (const r of rects) {
      const p = toPixelRect(r, width, height);
      if (!p) continue;
      const overlay = document.createElement("canvas");
      overlay.className = className;
      overlay.width = p.w;
      overlay.height = p.h;
      overlay.getContext("2d")?.drawImage(base, p.x, p.y, p.w, p.h, 0, 0, p.w, p.h);
      Object.assign(overlay.style, {
        left: `${(p.x / width) * 100}%`,
        top: `${(p.y / height) * 100}%`,
        width: `${(p.w / width) * 100}%`,
        height: `${(p.h / height) * 100}%`,
      });
      overlays.push(overlay);
    }
    return overlays;
  } catch (e) {
    // Without overlays photos just get the page transform: degraded, not broken.
    console.warn("Classifying page images failed", e);
    return [];
  }
}

/** Free overlay backing stores right away instead of waiting for GC. */
export function releaseOverlays(overlays: HTMLCanvasElement[]): void {
  for (const o of overlays) {
    o.width = 0;
    o.height = 0;
  }
}
