export interface Settings {
  night: boolean;
  zoom: number;
  originalImages: boolean;
}

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.1;

const KEY = "reader.settings";

/** In range, at 1% resolution (pinch zoom is continuous; buttons use `stepZoom`). */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  return Math.round(clamped * 100) / 100;
}

/** The next ZOOM_STEP mark up or down: 1.23 → 1.3 / 1.2, 1.2 → 1.3 / 1.1. */
export function stepZoom(z: number, direction: 1 | -1): number {
  const marks = z / ZOOM_STEP;
  // Tolerance so float noise (0.8999999999999999) counts as being on the mark.
  const onMark = Math.abs(marks - Math.round(marks)) < 1e-6;
  const current = onMark ? Math.round(marks) : direction > 0 ? Math.floor(marks) : Math.ceil(marks);
  return clampZoom((current + direction) * ZOOM_STEP);
}

// NOTE: index.html has an inline pre-paint script that duplicates the night
// default logic (same key, same matchMedia fallback, originalImages === true). Keep them in sync.
export function loadSettings(): Settings {
  let stored: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    stored = null;
  }
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;

  let night: boolean;
  if (typeof s.night === "boolean") {
    night = s.night;
  } else {
    try {
      night = matchMedia("(prefers-color-scheme: dark)").matches === true;
    } catch {
      night = false;
    }
  }
  const zoom = typeof s.zoom === "number" && Number.isFinite(s.zoom) ? clampZoom(s.zoom) : 1;
  return { night, zoom, originalImages: s.originalImages === true };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ night: s.night, zoom: s.zoom, originalImages: s.originalImages }));
  } catch {
    // Storage unavailable or full: settings just won't persist.
  }
}
