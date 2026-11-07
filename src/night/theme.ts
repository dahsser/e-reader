export const NIGHT_PAGE_FILTER = "invert(0.88) hue-rotate(180deg) sepia(0.18)";
export const PHOTO_FILTER = "brightness(0.85)";

export function applyTheme(night: boolean): void {
  document.documentElement.dataset.theme = night ? "night" : "day";
}
