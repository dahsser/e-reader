import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageSize, PdfDoc } from "./engine/types";
import { applyImages, applyTheme } from "./night/theme";
import { Reader } from "./reader/Reader";
import type { JumpRequest, ReadingPosition } from "./reader/useReaderSession";
import { getServices } from "./services";
import { clampZoom, loadSettings, saveSettings, stepZoom, type Settings } from "./settings/settings";
import { CleanupDialog } from "./shelf/CleanupDialog";
import { formatMB } from "./shelf/format";
import { Shelf } from "./shelf/Shelf";
import { LibraryFullError } from "./storage/library";
import type { BookMeta, Position } from "./storage/metaDb";
import { EmptyState } from "./ui/EmptyState";
import { PersistNotice } from "./ui/PersistNotice";
import { Toast } from "./ui/Toast";
import { Toolbar } from "./ui/Toolbar";
import {
  assertOpensAsPdf,
  dismissPersistNotice,
  persistNoticeDue,
  uploadBook,
  uploadErrorMessage,
} from "./ui/upload";

interface OpenBook {
  /** Unique per open, so reopening remounts the Reader. */
  session: number;
  meta: BookMeta;
  doc: PdfDoc;
  sizes: PageSize[];
  position: Position | null;
}

/** "superseded": a later open (or close) took over before this one finished. */
type OpenResult = "opened" | "failed" | "superseded";

/** An upload waiting for the user to make room. */
interface PendingUpload {
  file: File;
  neededBytes: number;
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
  /** Id of the open in flight (set at its start, cleared when that open finishes). */
  const openingId = useRef<{ seq: number; id: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [jump, setJump] = useState<JumpRequest | null>(null);
  const jumpSeq = useRef(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [shelfOpen, setShelfOpen] = useState(false);
  /** Bumped whenever the library changes, so an open shelf reloads. */
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [persistNotice, setPersistNotice] = useState(false);
  const positionSaveWarned = useRef(false);

  const showToast = useCallback((text: string) => setToast({ id: Date.now(), text }), []);
  const dismissToast = useCallback(() => setToast(null), []);
  const libraryChanged = useCallback(() => setLibraryVersion((v) => v + 1), []);
  const showPersistNotice = useCallback(() => setPersistNotice(true), []);

  const openBookById = useCallback(
    async (id: string): Promise<OpenResult> => {
      const seq = ++openSeq.current;
      openingId.current = { seq, id };
      try {
        const { engine, library } = await getServices();
        const { book: meta, bytes, position } = await library.openBook(id);
        if (seq !== openSeq.current) return "superseded";
        const doc = await engine.open(bytes);
        let sizes: PageSize[];
        try {
          sizes = await doc.getPageSizes();
          if (seq !== openSeq.current) {
            void doc.destroy();
            return "superseded";
          }
          // Only a book that actually opened (and is still wanted) counts as opened.
          await library.markOpened(id);
        } catch (e) {
          void doc.destroy();
          throw e;
        }
        if (seq !== openSeq.current) {
          void doc.destroy();
          return "superseded";
        }
        const prev = bookRef.current;
        if (prev) retiredDocs.current.push(prev.doc);
        const next = { session: seq, meta, doc, sizes, position };
        bookRef.current = next;
        setPage(position?.page ?? 0);
        setJump(null);
        setBook(next);
        return "opened";
      } catch (e) {
        if (seq !== openSeq.current) return "superseded";
        showToast(`Couldn't open this book: ${errorText(e)}`);
        return "failed";
      } finally {
        if (openingId.current?.seq === seq) openingId.current = null;
        if (seq === openSeq.current) setReady(true);
        libraryChanged(); // lastOpenedAt moved
      }
    },
    [showToast, libraryChanged],
  );

  /** Show the empty state; cancels any open in flight. */
  const closeBook = useCallback(() => {
    ++openSeq.current;
    const prev = bookRef.current;
    if (prev) retiredDocs.current.push(prev.doc);
    bookRef.current = null;
    setBook(null);
    setPage(0);
    setJump(null);
    setReady(true);
  }, []);

  /** Open the first book in shelf order that opens, skipping `skipId` (already tried); the empty state if none does. */
  const openFirstAvailable = useCallback(
    async (skipId: string | null = null) => {
      const { library } = await getServices();
      for (const b of await library.listBooks()) {
        if (b.id === skipId) continue;
        if ((await openBookById(b.id)) !== "failed") return;
      }
      closeBook();
    },
    [openBookById, closeBook],
  );

  // Destroy documents of books we switched away from, after the old Reader unmounted.
  useEffect(() => {
    for (const doc of retiredDocs.current.splice(0)) void doc.destroy();
  }, [book]);

  // Startup: reopen the last book, else the first on the shelf that opens, else show the empty state.
  useEffect(() => {
    applyTheme(settingsRef.current.night);
    applyImages(settingsRef.current.originalImages);
    let cancelled = false;
    (async () => {
      try {
        const { library } = await getServices();
        const id = await library.getLastBookId();
        if (cancelled) return;
        if (!id) await openFirstAvailable();
        else if ((await openBookById(id)) === "failed" && !cancelled) await openFirstAvailable(id);
      } catch (e) {
        if (cancelled) return;
        showToast(`Couldn't load the library: ${errorText(e)}`);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openBookById, openFirstAvailable, showToast]);

  // The persistence notice stays until dismissed.
  useEffect(() => {
    let cancelled = false;
    void persistNoticeDue()
      .then((due) => !cancelled && due && setPersistNotice(true))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const onDismissPersistNotice = useCallback(() => {
    dismissPersistNotice();
    setPersistNotice(false);
  }, []);

  /** Add the file and open it; if the shelf is full, ask the user to make room. */
  const addAndOpen = useCallback(
    async (file: File): Promise<OpenResult | "not added"> => {
      try {
        const services = await getServices();
        try {
          const meta = await uploadBook(file, services, { onPersistenceDenied: showPersistNotice });
          return await openBookById(meta.id);
        } catch (e) {
          if (!(e instanceof LibraryFullError)) throw e;
          const { usedBytes, capBytes } = await services.library.usage();
          if (e.neededBytes > usedBytes) {
            // Even an empty shelf couldn't hold it: there's no room to make.
            showToast(`This file (${formatMB(file.size)}) is larger than the ${formatMB(capBytes)} shelf`);
            return "not added";
          }
          // The size check runs before the file is parsed: only offer clean-up for a file we can add.
          await assertOpensAsPdf(file, services.engine);
          setPending({ file, neededBytes: e.neededBytes });
          return "not added";
        }
      } catch (e) {
        showToast(uploadErrorMessage(e));
        return "not added";
      } finally {
        libraryChanged();
      }
    },
    [openBookById, showToast, showPersistNotice, libraryChanged],
  );

  const onFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        await addAndOpen(file);
      } finally {
        setBusy(false);
      }
    },
    [addAndOpen],
  );

  const onCleanupConfirm = useCallback(
    async (ids: string[]) => {
      if (!pending) return;
      const { file } = pending;
      const removedOpenBook = bookRef.current !== null && ids.includes(bookRef.current.meta.id);
      setPending(null);
      setBusy(true);
      try {
        const { library } = await getServices();
        try {
          await library.removeBooks(ids);
        } catch (e) {
          showToast(`Couldn't remove books: ${errorText(e)}`);
          // Removal may have stopped part-way, after the open book was already gone.
          const openId = bookRef.current?.meta.id;
          if (removedOpenBook && openId && !(await library.listBooks()).some((b) => b.id === openId)) {
            await openFirstAvailable();
          }
          return;
        } finally {
          libraryChanged();
        }
        const result = await addAndOpen(file);
        // The removed book is still on screen unless something else opened.
        if (removedOpenBook && (result === "failed" || result === "not added")) {
          await openFirstAvailable();
        }
      } finally {
        setBusy(false);
      }
    },
    [pending, addAndOpen, openFirstAvailable, showToast, libraryChanged],
  );
  const onDeleteBook = useCallback(
    async (id: string) => {
      const wasOpen = bookRef.current?.meta.id === id;
      // A book still opening is dropped like the open one: cancel that open, then fall back.
      const wasOpening = openingId.current?.id === id;
      if (wasOpening) ++openSeq.current;
      const seqBefore = openSeq.current;
      const fallback = wasOpen || wasOpening;
      setBusy(true);
      setDeletingId(id);
      try {
        const { library } = await getServices();
        try {
          await library.removeBooks([id]);
        } catch (e) {
          showToast(`Couldn't delete the book: ${errorText(e)}`);
          // Removal may have gone through before failing.
          if (fallback && openSeq.current === seqBefore && !(await library.listBooks()).some((b) => b.id === id)) {
            await openFirstAvailable();
          }
          return;
        }
        // Skip the fallback if the user opened or closed something meanwhile.
        if (fallback && openSeq.current === seqBefore) await openFirstAvailable();
      } catch (e) {
        showToast(`Couldn't delete the book: ${errorText(e)}`);
      } finally {
        libraryChanged();
        setDeletingId(null);
        setBusy(false);
      }
    },
    [openFirstAvailable, showToast, libraryChanged],
  );
  const onCleanupCancel = useCallback(() => setPending(null), []);

  const openShelf = useCallback(() => setShelfOpen(true), []);
  const closeShelf = useCallback(() => setShelfOpen(false), []);
  const onShelfOpenBook = useCallback(
    (id: string) => {
      setShelfOpen(false);
      if (bookRef.current?.meta.id !== id) void openBookById(id);
    },
    [openBookById],
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
  const zoomIn = useCallback(() => changeZoom((z) => stepZoom(z, 1)), [changeZoom]);
  const zoomOut = useCallback(() => changeZoom((z) => stepZoom(z, -1)), [changeZoom]);
  const onZoomTo = useCallback((zoom: number) => changeZoom(() => zoom), [changeZoom]);

  const onGoToPage = useCallback((p: number) => setJump({ page: p, id: ++jumpSeq.current }), []);

  const toggleNight = useCallback(() => {
    const updated = { ...settingsRef.current, night: !settingsRef.current.night };
    settingsRef.current = updated;
    applyTheme(updated.night); // synchronously, so the whole UI flips in the same frame
    setSettings(updated);
    saveSettings(updated);
  }, []);

  const toggleImages = useCallback(() => {
    const updated = { ...settingsRef.current, originalImages: !settingsRef.current.originalImages };
    settingsRef.current = updated;
    applyImages(updated.originalImages);
    setSettings(updated);
    saveSettings(updated);
  }, []);

  // `n` toggles night view (and `i` original images, in night view) anywhere, except while typing or with modifiers held.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "n" && e.key !== "i") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "i") {
        if (!settingsRef.current.night) return;
        e.preventDefault();
        toggleImages();
        return;
      }
      e.preventDefault();
      toggleNight();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleNight, toggleImages]);

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
  // Rejects on failure so the Reader retries; the user is told once per session.
  const savePosition = useMemo(() => {
    if (!book) return async () => {};
    const { id } = book.meta;
    const pageCount = book.doc.numPages;
    return (pos: ReadingPosition) =>
      getServices()
        .then(({ library }) => library.savePosition(id, pos.page, pos.fraction, pageCount))
        .catch((e: unknown) => {
          if (!positionSaveWarned.current) {
            positionSaveWarned.current = true;
            showToast(`Couldn't save your reading position: ${errorText(e)}`);
          }
          throw e;
        });
  }, [book, showToast]);

  return (
    <div className="app">
      <Toolbar
        page={book ? { current: page + 1, total: book.doc.numPages } : null}
        zoom={settings.zoom}
        night={settings.night}
        shelfOpen={shelfOpen}
        originalImages={settings.originalImages}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onShelf={openShelf}
        onToggleNight={toggleNight}
        onToggleImages={toggleImages}
        onGoToPage={onGoToPage}
      />
      {persistNotice && <PersistNotice onDismiss={onDismissPersistNotice} />}
      {book ? (
        <Reader
          key={book.session}
          doc={book.doc}
          sizes={book.sizes}
          initialPosition={book.position}
          zoom={settings.zoom}
          onPageChange={setPage}
          savePosition={savePosition}
          onZoomTo={onZoomTo}
          jump={jump}
        />
      ) : ready ? (
        <EmptyState busy={busy} onFile={onFile} />
      ) : (
        <main className="loading" aria-busy="true" />
      )}
      {shelfOpen && (
        <Shelf
          version={libraryVersion}
          currentId={book?.meta.id ?? null}
          busy={busy}
          deleting={deletingId !== null}
          onOpenBook={onShelfOpenBook}
          onFile={onFile}
          onDeleteBook={onDeleteBook}
          onClose={closeShelf}
        />
      )}
      {pending && (
        <CleanupDialog
          key={`${pending.file.name}:${pending.neededBytes}`}
          fileName={pending.file.name}
          neededBytes={pending.neededBytes}
          busy={busy}
          onConfirm={onCleanupConfirm}
          onCancel={onCleanupCancel}
        />
      )}
      {toast && <Toast key={toast.id} message={toast.text} onDismiss={dismissToast} />}
    </div>
  );
}
