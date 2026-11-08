import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clampZoom, loadSettings, saveSettings } from "./settings";

const KEY = "reader.settings";

function stubDark(matches: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches, media: q }));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("settings", () => {
  test("loadSettings defaults follow the color scheme", () => {
    stubDark(true);
    expect(loadSettings()).toEqual({ night: true, zoom: 1, originalImages: false });
    stubDark(false);
    expect(loadSettings()).toEqual({ night: false, zoom: 1, originalImages: false });
  });

  test("loadSettings tolerates missing matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(loadSettings()).toEqual({ night: false, zoom: 1, originalImages: false });
  });

  test("loadSettings defaults and tolerates corrupt storage", () => {
    stubDark(true);
    localStorage.setItem(KEY, "not json");
    expect(loadSettings()).toEqual({ night: true, zoom: 1, originalImages: false });
    localStorage.setItem(KEY, "null");
    expect(loadSettings()).toEqual({ night: true, zoom: 1, originalImages: false });
  });

  test("loadSettings falls back per field on wrong types", () => {
    stubDark(true);
    localStorage.setItem(KEY, JSON.stringify({ night: "yes", zoom: 2, originalImages: false }));
    expect(loadSettings()).toEqual({ night: true, zoom: 2, originalImages: false });
    localStorage.setItem(KEY, JSON.stringify({ night: false, zoom: "big" }));
    expect(loadSettings()).toEqual({ night: false, zoom: 1, originalImages: false });
  });

  test("loadSettings clamps out-of-range zoom", () => {
    stubDark(false);
    localStorage.setItem(KEY, JSON.stringify({ night: false, zoom: 99 }));
    expect(loadSettings().zoom).toBe(3);
    localStorage.setItem(KEY, JSON.stringify({ night: false, zoom: 0.01 }));
    expect(loadSettings().zoom).toBe(0.5);
  });

  test("saveSettings round-trips", () => {
    stubDark(false);
    saveSettings({ night: true, zoom: 1.7, originalImages: false });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ night: true, zoom: 1.7, originalImages: false });
    expect(loadSettings()).toEqual({ night: true, zoom: 1.7, originalImages: false });
  });

  test("originalImages defaults false, round-trips true, ignores non-booleans", () => {
    stubDark(false);
    expect(loadSettings().originalImages).toBe(false);
    saveSettings({ night: true, zoom: 1, originalImages: true });
    expect(loadSettings().originalImages).toBe(true);
    localStorage.setItem(KEY, JSON.stringify({ night: true, zoom: 1, originalImages: "yes" }));
    expect(loadSettings().originalImages).toBe(false);
  });

  test("saveSettings swallows storage errors", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveSettings({ night: true, zoom: 1, originalImages: false })).not.toThrow();
    vi.restoreAllMocks();
  });

  test("clampZoom", () => {
    expect(clampZoom(3.4)).toBe(3);
    expect(clampZoom(0.94)).toBe(0.9);
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(1.25)).toBe(1.3);
    expect(clampZoom(NaN)).toBe(1);
  });
});
