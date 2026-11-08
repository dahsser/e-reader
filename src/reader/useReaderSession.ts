import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PageSize, PdfDoc } from "../engine/types";
import { layoutPages, positionAt, scrollTopFor } from "./layout";
import { RenderQueue } from "./renderQueue";

/** Space around the pages inside the scroll container (CSS px). */
export const READER_PADDING = 16;
const SAVE_DEBOUNCE_MS = 400;
const PREFETCH_MARGIN = "150% 0px";
/** Ctrl+wheel delta that makes one zoom step (one mouse-wheel notch ≈ 100). */
const WHEEL_STEP_DELTA = 50;
/** Below this container width the layout is degenerate (e.g. while hidden). */
const MIN_LAYOUT_WIDTH = 64;
/** Indicator tolerance so a sub-pixel rounding of scrollTop doesn't show the previous page. */
const INDICATOR_SLACK = 2;

export interface ReadingPosition {
  page: number;
  fraction: number;
}

/** Ask the reader to scroll a page to the top; each request has its own `id`. */
export interface JumpRequest {
  /** 0-based page. */
  page: number;
  id: number;
}

export interface ReaderSessionOptions {
  doc: PdfDoc;
  sizes: PageSize[];
  initialPosition: ReadingPosition | null;
  zoom: number;
  /** 0-based index of the page at the top of the view. */
  onPageChange: (page: number) => void;
  /** Rejects if the write failed; the position is then saved again on the next flush. */
  savePosition: (pos: ReadingPosition) => Promise<void>;
  onZoomStep: (direction: 1 | -1) => void;
  jump: JumpRequest | null;
}

/**
 * Scroll/render orchestration for one open document: layout, position
 * tracking + saving, zoom/resize position preservation, Ctrl+wheel zoom and
 * the IntersectionObservers that feed the RenderQueue.
 */
export function useReaderSession(opts: ReaderSessionOptions) {
  const { doc, sizes, zoom } = opts;
  const latest = useRef(opts);
  latest.current = opts;

  const mainRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  const [queue, setQueue] = useState<RenderQueue | null>(null);

  const layout = useMemo(
    () => (width >= MIN_LAYOUT_WIDTH ? layoutPages(sizes, width, zoom) : null),
    [sizes, width, zoom],
  );
  const layoutRef = useRef<typeof layout>(null);
  const posRef = useRef<ReadingPosition>(opts.initialPosition ?? { page: 0, fraction: 0 });
  const lastSaved = useRef<ReadingPosition | null>(opts.initialPosition);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // One render queue per document.
  useEffect(() => {
    const q = new RenderQueue(doc, sizes);
    setQueue(q);
    return () => q.dispose();
  }, [doc, sizes]);

  // Container width (the scrollbar gutter is always reserved, so it doesn't flip).
  useLayoutEffect(() => {
    const el = mainRef.current!;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // New layout (open, zoom, resize): restore the reading position, drop canvases.
  // Waits for `queue` too: the page content only mounts once both exist, and
  // restoring against an empty container would clamp scrollTop to 0.
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!layout || !queue || !el) return;
    layoutRef.current = layout;
    el.scrollTop = scrollTopFor(posRef.current, layout.boxes);
    latest.current.onPageChange(positionAt(el.scrollTop + INDICATOR_SLACK, layout.boxes).page);
  }, [layout, queue]);

  // Go-to-page requests: each id is handled once. The scroll handler then
  // updates the indicator, the render focus and the saved position.
  const handledJump = useRef<number | null>(null);
  const { jump } = opts;
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!jump || !layout || !queue || !el || handledJump.current === jump.id) return;
    handledJump.current = jump.id;
    const page = Math.min(Math.max(jump.page, 0), sizes.length - 1);
    el.scrollTop = scrollTopFor({ page, fraction: 0 }, layout.boxes);
    // Read back: near the end scrollTop clamps, and then no scroll event may fire.
    posRef.current = positionAt(el.scrollTop, layout.boxes);
  }, [jump, layout, queue, sizes]);

  useLayoutEffect(() => {
    if (queue && layout) queue.setLayout(layout.boxes);
  }, [queue, layout]);

  // Position tracking and saving.
  useEffect(() => {
    const el = mainRef.current!;
    const flush = () => {
      clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
      const pos = posRef.current;
      const prev = lastSaved.current;
      if (prev && prev.page === pos.page && prev.fraction === pos.fraction) return;
      // Only a write that landed counts, so a failed one is retried by the next scroll or pagehide.
      // The failure itself is reported by the caller.
      latest.current.savePosition(pos).then(
        () => {
          lastSaved.current = pos;
        },
        () => {},
      );
    };
    const onScroll = () => {
      const current = layoutRef.current;
      if (!current) return; // nothing restored yet; don't overwrite the saved position
      const pos = positionAt(el.scrollTop, current.boxes);
      posRef.current = pos;
      queue?.setFocus(pos.page);
      latest.current.onPageChange(positionAt(el.scrollTop + INDICATOR_SLACK, current.boxes).page);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
      if (saveTimer.current !== undefined) flush();
    };
  }, [queue]);

  // Ctrl/⌘ + wheel (and trackpad pinch) zoom. Needs a non-passive listener.
  useEffect(() => {
    const el = mainRef.current!;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < WHEEL_STEP_DELTA) return;
      latest.current.onZoomStep(acc < 0 ? 1 : -1);
      acc = 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // IntersectionObservers: prefetch zone → wanted, viewport → visible.
  const pages = useRef(new Set<HTMLElement>());
  const observers = useRef<IntersectionObserver[]>([]);
  useEffect(() => {
    if (!queue) return;
    const root = mainRef.current;
    const indexOf = (e: IntersectionObserverEntry) => Number((e.target as HTMLElement).dataset.page);
    const prefetch = new IntersectionObserver(
      (entries) => entries.forEach((e) => queue.setWanted(indexOf(e), e.isIntersecting)),
      { root, rootMargin: PREFETCH_MARGIN },
    );
    const visible = new IntersectionObserver(
      (entries) => entries.forEach((e) => queue.setVisible(indexOf(e), e.isIntersecting)),
      { root },
    );
    observers.current = [prefetch, visible];
    pages.current.forEach((el) => observers.current.forEach((o) => o.observe(el)));
    return () => {
      prefetch.disconnect();
      visible.disconnect();
      observers.current = [];
    };
  }, [queue]);

  /** Ref callback for page wrappers (stable identity). */
  const observePage = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    pages.current.add(el);
    observers.current.forEach((o) => o.observe(el));
    return () => {
      pages.current.delete(el);
      observers.current.forEach((o) => o.unobserve(el));
    };
  }, []);

  return { mainRef, layout, width, queue, observePage };
}
