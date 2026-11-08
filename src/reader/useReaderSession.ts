import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { PageSize, PdfDoc } from "../engine/types";
import { clampZoom, ZOOM_MAX, ZOOM_MIN } from "../settings/settings";
import { layoutPages, positionAt, scrollTopFor } from "./layout";
import { RenderQueue } from "./renderQueue";

/** Space around the pages inside the scroll container (CSS px). */
export const READER_PADDING = 16;
const SAVE_DEBOUNCE_MS = 400;
const PREFETCH_MARGIN = "150% 0px";
/** Pages are re-rendered sharp once zoom/resize has been still this long; until then canvases stretch. */
const SETTLE_MS = 150;
/** Chrome and Firefox report a trackpad pinch as Ctrl+wheel with deltaY = -100·ln(scale). */
const WHEEL_ZOOM_RATE = 0.01;
/** Per-event cap: one mouse-wheel notch (deltaY ≈ 100) zooms ~10%; pinch deltas are far smaller. */
const MAX_WHEEL_DELTA = 10;
const WHEEL_LINE_PX = 16;
/** A gesture ends after this long without wheel events; the next one starts from the current zoom. */
const GESTURE_IDLE_MS = 300;
/** Pointer movement (CSS px) within a gesture that picks a new zoom anchor. */
const POINTER_SLOP = 4;
/** Below this container width the layout is degenerate (e.g. while hidden). */
const MIN_LAYOUT_WIDTH = 64;
/** Indicator tolerance so a sub-pixel rounding of scrollTop doesn't show the previous page. */
const INDICATOR_SLACK = 2;

type PageBoxes = ReturnType<typeof layoutPages>["boxes"];

/** WebKit-only pinch event (not in the DOM typings). */
interface SafariGestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

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
  /** Continuous zoom from a pinch / Ctrl+wheel gesture (already in range, 1% resolution). */
  onZoomTo: (zoom: number) => void;
  jump: JumpRequest | null;
}

/** A content point to keep under the pointer across a zoom: page-relative, so layout-independent. */
interface ZoomAnchor {
  page: number;
  /** Position inside the page box, 0..1 (may lie outside, e.g. in a gap). */
  fx: number;
  fy: number;
  /** Pointer position inside the scroll container's viewport (CSS px). */
  px: number;
  py: number;
}

/** Left edge of the (uniform-width) page column, as Reader.tsx centres it. */
const pageLeft = (containerWidth: number, pageWidth: number) => Math.max(READER_PADDING, (containerWidth - pageWidth) / 2);

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
  const zoomAnchor = useRef<ZoomAnchor | null>(null);

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

  // New layout (open, zoom, resize): keep the pinch point under the pointer,
  // otherwise restore the reading position (top of the view).
  // Waits for `queue` too: the page content only mounts once both exist, and
  // restoring against an empty container would clamp scrollTop to 0.
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!layout || !queue || !el) return;
    layoutRef.current = layout;
    const anchor = zoomAnchor.current;
    zoomAnchor.current = null;
    if (anchor) {
      const box = layout.boxes[anchor.page];
      el.scrollTop = READER_PADDING + box.top + anchor.fy * box.height - anchor.py;
      el.scrollLeft = pageLeft(el.clientWidth, box.width) + anchor.fx * box.width - anchor.px;
      posRef.current = positionAt(el.scrollTop, layout.boxes);
    } else {
      el.scrollTop = scrollTopFor(posRef.current, layout.boxes);
    }
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
    el.focus({ preventScroll: true }); // so PageDown/arrow keys scroll the reader
    // Read back: near the end scrollTop clamps, and then no scroll event may fire.
    posRef.current = positionAt(el.scrollTop, layout.boxes);
  }, [jump, layout, queue, sizes]);

  // Hand the geometry to the queue: at once for a new document, otherwise only
  // once zoom/resize settles. Meanwhile the old canvases stretch with their boxes.
  const sentLayout = useRef<{ queue: RenderQueue; boxes: PageBoxes } | null>(null);
  useLayoutEffect(() => {
    if (!queue || !layout) return;
    const sent = sentLayout.current;
    if (sent?.queue === queue && sent.boxes === layout.boxes) return;
    const send = () => {
      sentLayout.current = { queue, boxes: layout.boxes };
      queue.setLayout(layout.boxes);
    };
    if (sent?.queue !== queue) return send();
    const timer = setTimeout(send, SETTLE_MS);
    return () => clearTimeout(timer);
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

  // Trackpad pinch and Ctrl/⌘ + wheel: continuous zoom around the pointer, at
  // most one relayout per frame. Needs non-passive listeners.
  useEffect(() => {
    const el = mainRef.current!;
    /** Unrounded target of the current gesture, so tiny pinch steps add up. */
    let goal: number | null = null;
    let pointer = { x: 0, y: 0 };
    let frame = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let safariBase: number | null = null;
    /**
     * The gesture's anchor, kept while the pointer stays put: re-reading it every frame would
     * accumulate drift whenever the scroll range clamps (e.g. the page still narrower than the view).
     */
    let held: (ZoomAnchor & { clientX: number; clientY: number }) | null = null;
    const endGesture = () => {
      goal = null;
      held = null;
    };

    const anchorAt = (clientX: number, clientY: number): ZoomAnchor | null => {
      const current = layoutRef.current;
      if (!current || current.boxes.length === 0) return null;
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left - el.clientLeft;
      const py = clientY - rect.top - el.clientTop;
      const y = el.scrollTop + py - READER_PADDING;
      const { page } = positionAt(y, current.boxes);
      const box = current.boxes[page];
      const x = el.scrollLeft + px - pageLeft(el.clientWidth, box.width);
      return { page, fx: x / box.width, fy: (y - box.top) / box.height, px, py };
    };
    const apply = () => {
      frame = 0;
      if (goal === null) return;
      const next = clampZoom(goal);
      if (next === latest.current.zoom) return;
      const moved = !held || Math.hypot(pointer.x - held.clientX, pointer.y - held.clientY) > POINTER_SLOP;
      if (moved) {
        const a = anchorAt(pointer.x, pointer.y);
        held = a && { ...a, clientX: pointer.x, clientY: pointer.y };
      }
      zoomAnchor.current = held;
      // Relayout and scroll in this frame, before paint, so the page never jumps.
      flushSync(() => latest.current.onZoomTo(next));
      zoomAnchor.current = null;
    };
    const zoomTo = (target: number, clientX: number, clientY: number) => {
      goal = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, target));
      pointer = { x: clientX, y: clientY };
      frame ||= requestAnimationFrame(apply);
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (safariBase !== null) return;
      const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? el.clientHeight : 1;
      const delta = Math.min(MAX_WHEEL_DELTA, Math.max(-MAX_WHEEL_DELTA, e.deltaY * unit));
      zoomTo((goal ?? latest.current.zoom) * Math.exp(-delta * WHEEL_ZOOM_RATE), e.clientX, e.clientY);
      clearTimeout(idle);
      idle = setTimeout(endGesture, GESTURE_IDLE_MS);
    };
    // Safari reports a pinch as gesture events (scale relative to the start) instead.
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      safariBase = latest.current.zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as SafariGestureEvent;
      if (safariBase !== null) zoomTo(safariBase * g.scale, g.clientX, g.clientY);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      safariBase = null;
      endGesture();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("gestureend", onGestureEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
      cancelAnimationFrame(frame);
      clearTimeout(idle);
    };
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
