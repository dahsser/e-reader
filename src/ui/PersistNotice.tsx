export const PERSIST_NOTICE_TEXT = "Your browser may clear stored books if the disk gets full.";

/** One-time, dismissible: shown while the browser hasn't granted persistent storage. */
export function PersistNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="notice" role="status">
      <span>{PERSIST_NOTICE_TEXT}</span>
      <button type="button" className="icon-button" aria-label="Dismiss notice" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
