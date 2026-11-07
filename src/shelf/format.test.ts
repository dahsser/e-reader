import { describe, expect, test } from "vitest";
import { formatLastOpened, formatMB, formatMBUp, formatProgress, formatUsage } from "./format";

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

describe("formatMB", () => {
  test("whole megabytes, rounded", () => {
    expect(formatMB(312 * MB)).toBe("312 MB");
    expect(formatMB(312.4 * MB)).toBe("312 MB");
    expect(formatMB(312.5 * MB)).toBe("313 MB");
    expect(formatMB(0)).toBe("0 MB");
  });
});

describe("formatMBUp", () => {
  test("rounds up so a shortfall never reads as 0 MB", () => {
    expect(formatMBUp(1)).toBe("1 MB");
    expect(formatMBUp(0.16 * MB)).toBe("1 MB");
    expect(formatMBUp(2 * MB)).toBe("2 MB");
    expect(formatMBUp(2 * MB + 1)).toBe("3 MB");
    expect(formatMBUp(0)).toBe("0 MB");
  });
});

describe("formatUsage", () => {
  test("used of cap", () => {
    expect(formatUsage(312 * MB, 500 * MB)).toBe("312 MB of 500 MB");
    expect(formatUsage(0, 500 * MB)).toBe("0 MB of 500 MB");
  });
});

describe("formatProgress", () => {
  test("whole percent", () => {
    expect(formatProgress(0.45)).toBe("45%");
    expect(formatProgress(0)).toBe("0%");
    expect(formatProgress(1)).toBe("100%");
    expect(formatProgress(0.004)).toBe("0%");
  });
});

describe("formatLastOpened", () => {
  // Noon local time, so ±hours stay on the same calendar day.
  const now = new Date(2026, 10, 7, 12, 0, 0).getTime();

  test("never opened", () => {
    expect(formatLastOpened(null, now)).toBe("never");
  });

  test("same calendar day is today", () => {
    expect(formatLastOpened(now, now)).toBe("today");
    expect(formatLastOpened(new Date(2026, 10, 7, 0, 0, 1).getTime(), now)).toBe("today");
  });

  test("counts calendar days", () => {
    expect(formatLastOpened(new Date(2026, 10, 6, 23, 59).getTime(), now)).toBe("1 day ago");
    expect(formatLastOpened(now - 3 * DAY, now)).toBe("3 days ago");
    expect(formatLastOpened(now - 6 * DAY, now)).toBe("6 days ago");
  });

  test("a week or older shows the locale date", () => {
    const ts = now - 7 * DAY;
    expect(formatLastOpened(ts, now)).toBe(new Date(ts).toLocaleDateString());
  });

  test("a timestamp in the future reads as today", () => {
    expect(formatLastOpened(now + 2 * DAY, now)).toBe("today");
  });
});
