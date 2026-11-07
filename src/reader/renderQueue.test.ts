import { describe, expect, it, vi } from "vitest";
import type { PageSize, PdfDoc, RenderResult } from "../engine/types";
import type { PageBox } from "./layout";
import { RenderQueue } from "./renderQueue";

interface Call {
  index: number;
  signal: AbortSignal;
  resolve: (r: RenderResult) => void;
  reject: (e: unknown) => void;
}

function fakeDoc(numPages: number) {
  const calls: Call[] = [];
  const doc = {
    numPages,
    renderPage: vi.fn((index: number, _canvas: HTMLCanvasElement, _scale: number, signal?: AbortSignal) => {
      return new Promise<RenderResult>((resolve, reject) => {
        const call = { index, signal: signal!, resolve, reject };
        calls.push(call);
        signal?.addEventListener("abort", () => {
          const e = new Error("Render aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }),
  } as unknown as PdfDoc;
  return { doc, calls };
}

const sizes: PageSize[] = Array.from({ length: 10 }, () => ({ width: 612, height: 792 }));
const boxes: PageBox[] = sizes.map((_, i) => ({ top: i * 1000, width: 600, height: 776 }));
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const { doc, calls } = fakeDoc(10);
  const q = new RenderQueue(doc, sizes, () => 1);
  q.setLayout(boxes);
  return { q, calls };
}

describe("RenderQueue", () => {
  it("renders one page at a time, visible pages first", async () => {
    const { q, calls } = setup();
    q.setFocus(3);
    q.setWanted(2, true);
    q.setWanted(3, true);
    q.setWanted(4, true);
    q.setVisible(4, true);
    await flush();
    expect(calls.map((c) => c.index)).toEqual([4]);
    calls[0].resolve({ imageRects: [] });
    await flush();
    expect(calls.map((c) => c.index)).toEqual([4, 3]);
    expect(q.get(4)?.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(q.get(4)?.imageRects).toEqual([]);
  });

  it("aborts the in-flight render when its page leaves the zone, then moves on", async () => {
    const { q, calls } = setup();
    q.setWanted(0, true);
    q.setWanted(9, true);
    await flush();
    expect(calls[0].index).toBe(0);
    q.setWanted(0, false);
    expect(calls[0].signal.aborted).toBe(true);
    await flush();
    expect(calls.map((c) => c.index)).toEqual([0, 9]);
    expect(q.get(0)).toBeUndefined();
  });

  it("evicts a rendered page when it leaves the zone and notifies subscribers", async () => {
    const { q, calls } = setup();
    const onChange = vi.fn();
    q.subscribe(1, onChange);
    q.setWanted(1, true);
    await flush();
    calls[0].resolve({ imageRects: [] });
    await flush();
    const canvas = q.get(1)!.canvas;
    expect(onChange).toHaveBeenCalledTimes(1);
    q.setWanted(1, false);
    expect(q.get(1)).toBeUndefined();
    expect(canvas.width).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("drops canvases and re-renders wanted pages on relayout", async () => {
    const { q, calls } = setup();
    q.setWanted(5, true);
    await flush();
    calls[0].resolve({ imageRects: [] });
    await flush();
    expect(q.get(5)).toBeDefined();
    q.setLayout(boxes.map((b) => ({ ...b, width: b.width * 2 })));
    expect(q.get(5)).toBeUndefined();
    await flush();
    expect(calls.map((c) => c.index)).toEqual([5, 5]);
  });

  it("swallows aborts and discards results after dispose", async () => {
    const { q, calls } = setup();
    q.setWanted(2, true);
    await flush();
    q.dispose();
    expect(calls[0].signal.aborted).toBe(true);
    await flush();
    expect(q.get(2)).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});
