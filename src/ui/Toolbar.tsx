import { useState } from "react";

/** Stable ref callback: selects once on mount, not on every re-render while editing. */
const selectAll = (el: HTMLInputElement | null) => el?.select();

export interface ToolbarProps {
  /** Present while a book is open. */
  page: { current: number; total: number } | null;
  zoom: number;
  night: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onShelf: () => void;
  onToggleNight: () => void;
  /** 0-based page, already clamped to the book. */
  onGoToPage: (page: number) => void;
}

function PageIndicator({ current, total, onGoToPage }: { current: number; total: number; onGoToPage: (page: number) => void }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        className="page-indicator"
        data-testid="page-indicator"
        title="Go to page"
        onClick={() => setEditing(true)}
      >
        {current} / {total}
      </button>
    );
  }
  return (
    <span className="page-indicator" data-testid="page-indicator">
      <input
        data-testid="page-input"
        aria-label="Page number"
        inputMode="numeric"
        className="page-input"
        defaultValue={current}
        ref={selectAll}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setEditing(false);
          } else if (e.key === "Enter") {
            const n = parseInt(e.currentTarget.value, 10);
            setEditing(false);
            if (!Number.isNaN(n)) onGoToPage(Math.min(Math.max(n, 1), total) - 1);
          }
        }}
        onBlur={() => setEditing(false)}
      />{" "}
      <span>/ {total}</span>
    </span>
  );
}

export function Toolbar({ page, zoom, night, onZoomIn, onZoomOut, onShelf, onToggleNight, onGoToPage }: ToolbarProps) {
  return (
    <header className="toolbar" role="toolbar" aria-label="Reader controls">
      <button type="button" aria-label="Shelf" title="Shelf" onClick={onShelf}>
        ☰
      </button>
      <span className="toolbar-spacer" />
      {page && (
        <>
          <button type="button" aria-label="Zoom out" onClick={onZoomOut}>
            −
          </button>
          <span className="zoom-level">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={onZoomIn}>
            +
          </button>
          <PageIndicator current={page.current} total={page.total} onGoToPage={onGoToPage} />
        </>
      )}
      <span className="toolbar-spacer" />
      <button type="button" aria-label="Night view" aria-pressed={night} title="Night view (N)" onClick={onToggleNight}>
        ☾
      </button>
    </header>
  );
}
