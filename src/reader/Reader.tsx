import { PageView } from "./PageView";
import { READER_PADDING, useReaderSession, type ReaderSessionOptions } from "./useReaderSession";

/** Continuous vertical scroll of every page of one document. */
export function Reader(props: ReaderSessionOptions) {
  const { mainRef, layout, width, queue, observePage } = useReaderSession(props);
  const pageWidth = layout?.boxes[0]?.width ?? 0;
  const left = Math.max(READER_PADDING, (width - pageWidth) / 2);

  return (
    <main ref={mainRef} className="reader" tabIndex={-1}>
      {layout && queue && (
        <div
          className="reader-content"
          style={{
            height: layout.totalHeight + 2 * READER_PADDING,
            width: Math.max(width, pageWidth + 2 * READER_PADDING),
          }}
        >
          {layout.boxes.map((box, i) => (
            <PageView
              key={i}
              index={i}
              box={box}
              top={box.top + READER_PADDING}
              left={left}
              queue={queue}
              observe={observePage}
            />
          ))}
        </div>
      )}
    </main>
  );
}
