import { useEffect, useState, type KeyboardEvent } from "react";
import { getServices } from "../services";
import { formatLastOpened, formatMB, formatMBUp, formatProgress } from "./format";
import { Modal } from "./Modal";
import { Thumbnail, withProgress, type ShelfEntry } from "./Shelf";

export interface CleanupDialogProps {
  fileName: string;
  /** Bytes that must be freed before the pending file fits. */
  neededBytes: number;
  busy: boolean;
  onConfirm: (ids: string[]) => void;
  onCancel: () => void;
}

/** "Make room": pick books to remove, least read first, until the pending upload fits. Nothing is preselected. */
export function CleanupDialog({ fileName, neededBytes, busy, onConfirm, onCancel }: CleanupDialogProps) {
  const [entries, setEntries] = useState<ShelfEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { library } = await getServices();
        const list = await withProgress(await library.cleanupCandidates());
        if (!cancelled) setEntries(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const onRowKey = (e: KeyboardEvent, id: string) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    toggle(id);
  };

  const selectedBytes = (entries ?? []).reduce((n, { book }) => (selected.has(book.id) ? n + book.size : n), 0);
  const enough = selectedBytes >= neededBytes;
  const now = Date.now();

  return (
    <Modal label="Make room" onClose={onCancel} className="cleanup">
      {/* Rounded up so a small shortfall never reads "Need 0 MB". */}
      <h2>
        Need {formatMBUp(neededBytes)} more to add “{fileName}”
      </h2>
      <p className="cleanup-hint">Tick books to remove, least read first. Their reading positions are kept.</p>
      {error && <p className="shelf-message">Couldn't load the shelf: {error}</p>}
      {entries && (
        <div className="cleanup-list" role="group" aria-label="Books to remove">
          {entries.map(({ book, progress }) => {
            const checked = selected.has(book.id);
            return (
              <div
                key={book.id}
                className="cleanup-row"
                role="checkbox"
                aria-checked={checked}
                aria-disabled={busy || undefined}
                tabIndex={0}
                onClick={() => !busy && toggle(book.id)}
                onKeyDown={(e) => !busy && onRowKey(e, book.id)}
              >
                <span className="check" aria-hidden="true">
                  {checked ? "✓" : ""}
                </span>
                <Thumbnail blob={book.thumbnail} />
                <span className="book-text">
                  <span className="book-title">{book.title}</span>
                  <span className="book-detail">{book.fileName}</span>
                  <span className="book-detail">
                    {formatMB(book.size)} · {formatProgress(progress)} read · Last opened:{" "}
                    {formatLastOpened(book.lastOpenedAt, now)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="cleanup-status" data-testid="cleanup-status" aria-live="polite">
        {enough
          ? "Enough space"
          : // "still need" rounds up like the heading, so it never reads "0 MB" while space is missing.
            `Selected frees ${formatMB(selectedBytes)} — still need ${formatMBUp(neededBytes - selectedBytes)}`}
      </p>
      <div className="modal-actions">
        <button type="button" className="button-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="button-primary"
          disabled={!enough || busy}
          onClick={() => onConfirm([...selected])}
        >
          Remove selected and add
        </button>
      </div>
    </Modal>
  );
}
