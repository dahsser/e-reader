export interface ToolbarProps {
  /** Present while a book is open. */
  page: { current: number; total: number } | null;
  zoom: number;
  night: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onShelf: () => void;
  onToggleNight: () => void;
}

export function Toolbar({ page, zoom, night, onZoomIn, onZoomOut, onShelf, onToggleNight }: ToolbarProps) {
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
          <span className="page-indicator" data-testid="page-indicator">
            {page.current} / {page.total}
          </span>
        </>
      )}
      <span className="toolbar-spacer" />
      <button type="button" aria-label="Night view" aria-pressed={night} title="Night view (N)" onClick={onToggleNight}>
        ☾
      </button>
    </header>
  );
}
