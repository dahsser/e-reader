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
    expect(loadSettings()).toEqual({ night: true, zoom: 1 });
    stubDark(false);
    expect(loadSettings()).toEqual({ night: false, zoom: 1 });
  });

  test("loadSettings tolerates missing matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(loadSettings()).toEqual({ night: false, zoom: 1 });
  });

  test("loadSettings defaults and tolerates corrupt storage", () => {
    stubDark(true);
    localStorage.setItem(KEY, "not json");
    expect(loadSettings()).toEqual({ night: true, zoom: 1 });
    localStorage.setItem(KEY, "null");
    expect(loadSettings()).toEqual({ night: true, zoom: 1 });
  });

  test("loadSettings falls back per field on wrong types", () => {
    stubDark(true);
    localStorage.setItem(KEY, JSON.stringify({ night: "yes", zoom: 2 }));
    expect(loadSettings()).toEqual({ night: true, zoom: 2 });
    localStorage.setItem(KEY, JSON.stringify({ night: false, zoom: "big" }));
    expect(loadSettings()).toEqual({ night: false, zoom: 1 });
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
    saveSettings({ night: true, zoom: 1.7 });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ night: true, zoom: 1.7 });
    expect(loadSettings()).toEqual({ night: true, zoom: 1.7 });
  });

  test("saveSettings swallows storage errors", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveSettings({ night: true, zoom: 1 })).not.toThrow();
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
