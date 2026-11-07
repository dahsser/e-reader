const BYTES_PER_MB = 1024 * 1024;
const WEEK_DAYS = 7;

/** Whole megabytes, rounded: `"312 MB"`. */
export function formatMB(bytes: number): string {
  return `${Math.round(bytes / BYTES_PER_MB)} MB`;
}

/**
 * Whole megabytes, rounded UP — for shortfalls ("Need 1 MB more"), which must never
 * read as "0 MB" while space is still missing.
 */
export function formatMBUp(bytes: number): string {
  return `${Math.ceil(bytes / BYTES_PER_MB)} MB`;
}

/** `"312 MB of 500 MB"`. */
export function formatUsage(used: number, cap: number): string {
  return `${formatMB(used)} of ${formatMB(cap)}`;
}

/** Reading progress 0..1 as a whole percent: `"45%"`. */
export function formatProgress(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** `"never"`, `"today"`, `"3 days ago"` (calendar days, under a week), else the locale date. */
export function formatLastOpened(ts: number | null, now: number): string {
  if (ts === null) return "never";
  // Round: a day across a DST change is 23 or 25 hours long.
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < WEEK_DAYS) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}
