import { memo, useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
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

/** One page slot: placeholder background until the queue hands over a rendered canvas. */
export const PageView = memo(function PageView({ index, box, top, left, queue, observe }: PageViewProps) {
  const subscribe = useCallback((cb: () => void) => queue.subscribe(index, cb), [queue, index]);
  const rendered = useSyncExternalStore(subscribe, () => queue.get(index));
  const hostRef = useRef<HTMLDivElement>(null);

  // The canvas is created by the queue, so it is attached outside React's tree.
  useLayoutEffect(() => {
    const host = hostRef.current!;
    if (rendered) host.replaceChildren(rendered.canvas);
    else host.replaceChildren();
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
