import type { NormRect, PageSize, PdfDoc } from "../engine/types";
import { renderScale, type PageBox } from "./layout";
import { pickNextPage } from "./scheduler";

export interface RenderedPage {
  canvas: HTMLCanvasElement;
  imageRects: NormRect[];
}

interface InFlight {
  index: number;
  controller: AbortController;
}

/**
 * Renders pages of one document one at a time into detached canvases.
 * Callers feed it which pages are wanted (prefetch zone) and visible; it
 * picks the next page with `pickNextPage`, aborts the in-flight render when
 * its page leaves the zone, and evicts canvases of pages that leave.
 * Framework-free so it can be unit-tested and driven from a React hook.
 */
export class RenderQueue {
  private boxes: PageBox[] = [];
  private want = new Set<number>();
  private visible = new Set<number>();
  private rendered = new Map<number, RenderedPage>();
  private failed = new Set<number>();
  private listeners = new Map<number, Set<() => void>>();
  private inflight: InFlight | null = null;
  private focus = 0;
  private disposed = false;
  private pumpScheduled = false;

  constructor(
    private doc: PdfDoc,
    private sizes: PageSize[],
    private dpr: () => number = () => window.devicePixelRatio || 1,
  ) {}

  /** New geometry (zoom/resize): abort, drop all canvases, re-render wanted pages. */
  setLayout(boxes: PageBox[]): void {
    this.boxes = boxes;
    this.inflight?.controller.abort();
    this.failed.clear();
    for (const i of [...this.rendered.keys()]) this.evict(i);
    this.schedulePump();
  }

  setFocus(page: number): void {
    this.focus = page;
  }

  setWanted(index: number, wanted: boolean): void {
    if (wanted) {
      this.want.add(index);
    } else {
      this.want.delete(index);
      if (this.inflight?.index === index) this.inflight.controller.abort();
      this.evict(index);
    }
    this.schedulePump();
  }

  setVisible(index: number, isVisible: boolean): void {
    if (isVisible) this.visible.add(index);
    else this.visible.delete(index);
    this.schedulePump();
  }

  get(index: number): RenderedPage | undefined {
    return this.rendered.get(index);
  }

  subscribe(index: number, cb: () => void): () => void {
    let set = this.listeners.get(index);
    if (!set) this.listeners.set(index, (set = new Set()));
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.inflight?.controller.abort();
    for (const i of [...this.rendered.keys()]) this.evict(i);
    this.listeners.clear();
  }

  private notify(index: number): void {
    this.listeners.get(index)?.forEach((cb) => cb());
  }

  private evict(index: number): void {
    const page = this.rendered.get(index);
    if (!page) return;
    this.rendered.delete(index);
    // Release the backing store right away instead of waiting for GC.
    page.canvas.width = 0;
    page.canvas.height = 0;
    this.notify(index);
  }

  /** Coalesce a batch of observer updates into one scheduling decision. */
  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (this.disposed || this.inflight || this.boxes.length === 0) return;
    const done = new Set([...this.rendered.keys(), ...this.failed]);
    const index = pickNextPage(this.want, done, this.visible, (i) => Math.abs(i - this.focus));
    if (index === -1) return;

    const controller = new AbortController();
    const job: InFlight = { index, controller };
    this.inflight = job;
    const canvas = document.createElement("canvas");
    canvas.className = "page-base";
    const scale = renderScale(this.boxes[index], this.sizes[index], this.dpr());

    this.doc
      .renderPage(index, canvas, scale, controller.signal)
      .then(
        (result) => {
          if (this.disposed || controller.signal.aborted || !this.want.has(index)) {
            canvas.width = 0;
            canvas.height = 0;
            return;
          }
          this.rendered.set(index, { canvas, imageRects: result.imageRects });
          this.notify(index);
        },
        (e: unknown) => {
          canvas.width = 0;
          canvas.height = 0;
          if (this.disposed || controller.signal.aborted || (e as Error)?.name === "AbortError") return;
          this.failed.add(index);
          console.warn(`Rendering page ${index + 1} failed`, e);
        },
      )
      .finally(() => {
        if (this.inflight === job) this.inflight = null;
        this.schedulePump();
      });
  }
}
