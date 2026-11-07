import { describe, expect, test } from "vitest";
import { pickNextPage } from "./scheduler";

const dist = (i: number) => Math.abs(i - 2);

describe("pickNextPage", () => {
  test("prefers visible pages then nearest", () => {
    const want = new Set([1, 2, 3, 9]);
    expect(pickNextPage(want, new Set(), new Set([3]), dist)).toBe(3);
    expect(pickNextPage(want, new Set([3]), new Set([3]), dist)).toBe(2);
    expect(pickNextPage(want, new Set([3, 2]), new Set([3]), dist)).toBe(1);
    expect(pickNextPage(want, new Set([3, 2, 1]), new Set([3]), dist)).toBe(9);
  });

  test("returns -1 when all wanted pages are rendered", () => {
    expect(pickNextPage(new Set([1, 2]), new Set([1, 2, 5]), new Set([1]), dist)).toBe(-1);
    expect(pickNextPage(new Set(), new Set(), new Set(), dist)).toBe(-1);
  });
});
