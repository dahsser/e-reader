import { useEffect } from "react";

const TOAST_MS = 6000;

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  return (
    <div className="toast" role="alert">
      <span>{message}</span>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
