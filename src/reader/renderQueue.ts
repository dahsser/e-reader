import type { NormRect, PageSize, PdfDoc } from "../engine/types";
import { renderScale, type PageBox } from "./layout";
import { pickNextPage } from "./scheduler";

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

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
 * its page leaves the zone, and evicts canvases of pages that leave. On a new
 * layout, rendered pages go stale: they stay on screen (stretched by CSS) and
 * are swapped for a sharp render when it lands, so zooming never blanks a page.
 * Framework-free so it can be unit-tested and driven from a React hook.
 */
export class RenderQueue {
  private boxes: PageBox[] = [];
  private want = new Set<number>();
  private visible = new Set<number>();
  private rendered = new Map<number, RenderedPage>();
  /** Rendered at an old layout: still shown, waiting for a re-render. */
  private stale = new Set<number>();
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

  /** New geometry (zoom/resize): abort, re-render wanted pages, keeping the old canvases meanwhile. */
  setLayout(boxes: PageBox[]): void {
    this.boxes = boxes;
    this.inflight?.controller.abort();
    this.failed.clear();
    this.stale = new Set(this.rendered.keys());
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
    this.stale.delete(index);
    // Release the backing store right away instead of waiting for GC.
    releaseCanvas(page.canvas);
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
    for (const i of this.stale) done.delete(i);
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
            releaseCanvas(canvas);
            return;
          }
          const old = this.rendered.get(index);
          this.stale.delete(index);
          this.rendered.set(index, { canvas, imageRects: result.imageRects });
          this.notify(index);
          // Subscribers swap synchronously-ish (React commits store updates in a microtask);
          // release the replaced canvas only after that, or the page would flash blank.
          if (old) setTimeout(() => releaseCanvas(old.canvas), 0);
        },
        (e: unknown) => {
          releaseCanvas(canvas);
          if (this.disposed || controller.signal.aborted || (e as Error)?.name === "AbortError") return;
          // A stale page keeps showing its old canvas; don't retry until the next layout.
          this.stale.delete(index);
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
