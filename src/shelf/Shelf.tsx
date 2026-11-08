import { useEffect, useState, type ChangeEvent } from "react";
import { getServices } from "../services";
import { progressOf } from "../storage/library";
import type { BookMeta } from "../storage/metaDb";
import { formatMB, formatProgress } from "./format";
import { Modal } from "./Modal";
import { UsageBar } from "./UsageBar";

export interface ShelfEntry {
  book: BookMeta;
  progress: number;
}

/** Books (in the given order) with their reading progress. */
export async function withProgress(books: BookMeta[]): Promise<ShelfEntry[]> {
  const { library } = await getServices();
  return Promise.all(books.map(async (book) => ({ book, progress: progressOf(await library.getPosition(book.id)) })));
}

/** Page-1 thumbnail, or a neutral placeholder. */
export function Thumbnail({ blob }: { blob: Blob | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [blob]);
  return url ? <img className="thumb" src={url} alt="" /> : <span className="thumb thumb-empty" aria-hidden="true" />;
}

interface ShelfData {
  entries: ShelfEntry[];
  usedBytes: number;
  capBytes: number;
}

export interface ShelfProps {
  /** Bump to reload books and usage after the library changed. */
  version: number;
  currentId: string | null;
  busy: boolean;
  onOpenBook: (id: string) => void;
  onFile: (file: File) => void;
  onDeleteBook: (id: string) => void;
  onClose: () => void;
}

export function Shelf({ version, currentId, busy, onOpenBook, onFile, onDeleteBook, onClose }: ShelfProps) {
  const [data, setData] = useState<ShelfData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The one row asking "Delete this book?". */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { library } = await getServices();
        const [books, usage] = await Promise.all([library.listBooks(), library.usage()]);
        const entries = await withProgress(books);
        if (!cancelled) {
          setData({ entries, ...usage });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again
    if (file) onFile(file);
  };

  return (
    <Modal label="Shelf" onClose={onClose} className="shelf" variant="drawer">
      <div className="modal-header">
        <h2>Shelf</h2>
        <button type="button" className="icon-button" aria-label="Close shelf" onClick={onClose}>
          ×
        </button>
      </div>
      <label className="button-primary shelf-add" aria-disabled={busy}>
        {busy ? "Adding…" : "Add PDF"}
        <input
          type="file"
          data-testid="shelf-upload"
          accept="application/pdf"
          className="visually-hidden"
          disabled={busy}
          onChange={onChange}
        />
      </label>
      {error && <p className="shelf-message">Couldn't load the shelf: {error}</p>}
      {data && data.entries.length === 0 && <p className="shelf-message">No books yet.</p>}
      {data && data.entries.length > 0 && (
        <ul className="shelf-list">
          {data.entries.map(({ book, progress }) => (
            <li key={book.id} className="shelf-row">
              <div className="shelf-row-main">
                <button
                  type="button"
                  className="shelf-book"
                  data-testid="shelf-book"
                  aria-current={book.id === currentId ? "true" : undefined}
                  onClick={() => onOpenBook(book.id)}
                >
                  <Thumbnail blob={book.thumbnail} />
                  <span className="book-text">
                    <span className="book-title">{book.title}</span>
                    <span className="book-detail">{book.fileName}</span>
                    <span className="book-detail">
                      {formatProgress(progress)} read · {formatMB(book.size)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="shelf-delete"
                  className="icon-button"
                  aria-label={`Delete ${book.title}`}
                  title="Delete"
                  disabled={busy}
                  onClick={() => setConfirmId(book.id)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </button>
              </div>
              {confirmId === book.id && (
                <div className="shelf-confirm" role="group" aria-label="Confirm delete">
                  <span>Delete this book?</span>
                  <button
                    type="button"
                    className="button-secondary button-danger"
                    disabled={busy}
                    onClick={() => {
                      setConfirmId(null);
                      onDeleteBook(book.id);
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" className="button-secondary" onClick={() => setConfirmId(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && <UsageBar usedBytes={data.usedBytes} capBytes={data.capBytes} />}
    </Modal>
  );
}
