import { memo, useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createImageOverlays, releaseOverlays } from "../night/overlays";
import type { PageBox } from "./layout";
import type { RenderQueue } from "./renderQueue";

export interface PageViewProps {
  index: number;
  box: PageBox;
  top: number;
  left: number;
  queue: RenderQueue;
  observe: (el: HTMLElement | null) => void | (() => void);
}

/**
 * One page slot: placeholder background until the queue hands over a rendered
 * canvas, plus photo overlays for night view (rebuilt with every new canvas).
 */
export const PageView = memo(function PageView({ index, box, top, left, queue, observe }: PageViewProps) {
  const subscribe = useCallback((cb: () => void) => queue.subscribe(index, cb), [queue, index]);
  const rendered = useSyncExternalStore(subscribe, () => queue.get(index));
  const hostRef = useRef<HTMLDivElement>(null);

  // The canvas is created by the queue, so it is attached outside React's tree.
  // A new `rendered` (re-render) or none (evicted) drops the old overlays too.
  useLayoutEffect(() => {
    const host = hostRef.current!;
    if (!rendered) {
      host.replaceChildren();
      return;
    }
    const overlays = createImageOverlays(rendered.canvas, rendered.imageRects);
    host.replaceChildren(rendered.canvas, ...overlays);
    return () => releaseOverlays(overlays);
  }, [rendered]);

  return (
    <div
      ref={observe}
      className="page"
      data-testid="page"
      data-page={index}
      style={{ top, left, width: box.width, height: box.height }}
    >
      <div ref={hostRef} className="page-canvas" />
    </div>
  );
});
