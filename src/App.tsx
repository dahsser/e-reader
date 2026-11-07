import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageSize, PdfDoc } from "./engine/types";
import { applyTheme } from "./night/theme";
import { Reader } from "./reader/Reader";
import type { ReadingPosition } from "./reader/useReaderSession";
import { getServices } from "./services";
import { clampZoom, loadSettings, saveSettings, ZOOM_STEP, type Settings } from "./settings/settings";
import type { BookMeta, Position } from "./storage/metaDb";
import { EmptyState } from "./ui/EmptyState";
import { Toast } from "./ui/Toast";
import { Toolbar } from "./ui/Toolbar";
import { uploadBook, uploadErrorMessage } from "./ui/upload";

interface OpenBook {
  /** Unique per open, so reopening remounts the Reader. */
  session: number;
  meta: BookMeta;
  doc: PdfDoc;
  sizes: PageSize[];
  position: Position | null;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const settingsRef = useRef(settings);
  const [ready, setReady] = useState(false);
  const [book, setBook] = useState<OpenBook | null>(null);
  const bookRef = useRef<OpenBook | null>(null);
  const retiredDocs = useRef<PdfDoc[]>([]);
  const openSeq = useRef(0);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const showToast = useCallback((text: string) => setToast({ id: Date.now(), text }), []);
  const dismissToast = useCallback(() => setToast(null), []);

  const openBookById = useCallback(
    async (id: string) => {
      const seq = ++openSeq.current;
      try {
        const { engine, library } = await getServices();
        const { book: meta, bytes, position } = await library.openBook(id);
        if (seq !== openSeq.current) return;
        const doc = await engine.open(bytes);
        let sizes: PageSize[];
        try {
          sizes = await doc.getPageSizes();
        } catch (e) {
          void doc.destroy();
          throw e;
        }
        if (seq !== openSeq.current) {
          void doc.destroy();
          return;
        }
        const prev = bookRef.current;
        if (prev) retiredDocs.current.push(prev.doc);
        const next = { session: seq, meta, doc, sizes, position };
        bookRef.current = next;
        setPage(position?.page ?? 0);
        setBook(next);
      } catch (e) {
        if (seq === openSeq.current) showToast(`Couldn't open this book: ${errorText(e)}`);
      } finally {
        if (seq === openSeq.current) setReady(true);
      }
    },
    [showToast],
  );

  // Destroy documents of books we switched away from, after the old Reader unmounted.
  useEffect(() => {
    for (const doc of retiredDocs.current.splice(0)) void doc.destroy();
  }, [book]);

  // Startup: reopen the last book, else show the empty state.
  useEffect(() => {
    applyTheme(settingsRef.current.night);
    let cancelled = false;
    (async () => {
      try {
        const { library } = await getServices();
        const id = await library.getLastBookId();
        if (cancelled) return;
        if (id) await openBookById(id);
        else setReady(true);
      } catch (e) {
        if (cancelled) return;
        showToast(`Couldn't load the library: ${errorText(e)}`);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openBookById, showToast]);

  const onFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const meta = await uploadBook(file, await getServices());
        await openBookById(meta.id);
      } catch (e) {
        showToast(uploadErrorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [openBookById, showToast],
  );

  const changeZoom = useCallback((next: (zoom: number) => number) => {
    const s = settingsRef.current;
    const zoom = clampZoom(next(s.zoom));
    if (zoom === s.zoom) return;
    const updated = { ...s, zoom };
    settingsRef.current = updated;
    setSettings(updated);
    saveSettings(updated);
  }, []);
  const zoomIn = useCallback(() => changeZoom((z) => z + ZOOM_STEP), [changeZoom]);
  const zoomOut = useCallback(() => changeZoom((z) => z - ZOOM_STEP), [changeZoom]);
  const onZoomStep = useCallback((dir: 1 | -1) => (dir > 0 ? zoomIn() : zoomOut()), [zoomIn, zoomOut]);

  // Ctrl/⌘ + = / + / - / 0 while reading.
  useEffect(() => {
    if (!book) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === "=" || e.key === "+") zoomIn();
      else if (e.key === "-") zoomOut();
      else if (e.key === "0") changeZoom(() => 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [book, zoomIn, zoomOut, changeZoom]);

  // Bound to its book: an unmounting Reader may flush after the next book is set.
  const savePosition = useMemo(() => {
    if (!book) return () => {};
    const { id } = book.meta;
    const pageCount = book.doc.numPages;
    return (pos: ReadingPosition) => {
      void getServices()
        .then(({ library }) => library.savePosition(id, pos.page, pos.fraction, pageCount))
        .catch((e) => console.warn("Saving the reading position failed", e));
    };
  }, [book]);

  return (
    <div className="app">
      <Toolbar
        page={book ? { current: page + 1, total: book.doc.numPages } : null}
        zoom={settings.zoom}
        night={settings.night}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
      />
      {book ? (
        <Reader
          key={book.session}
          doc={book.doc}
          sizes={book.sizes}
          initialPosition={book.position}
          zoom={settings.zoom}
          onPageChange={setPage}
          savePosition={savePosition}
          onZoomStep={onZoomStep}
        />
      ) : ready ? (
        <EmptyState busy={busy} onFile={onFile} />
      ) : (
        <main className="loading" aria-busy="true" />
      )}
      {toast && <Toast key={toast.id} message={toast.text} onDismiss={dismissToast} />}
    </div>
  );
}
