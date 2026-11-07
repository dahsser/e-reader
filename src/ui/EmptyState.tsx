import type { ChangeEvent } from "react";

export function EmptyState({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again
    if (file) onFile(file);
  };

  return (
    <main className="empty-state">
      <h1>No book open</h1>
      <p>Add a PDF to start reading. It stays on this device.</p>
      <label className="button-primary" aria-disabled={busy}>
        {busy ? "Adding…" : "Open a PDF"}
        <input
          type="file"
          data-testid="upload-input"
          accept="application/pdf"
          className="visually-hidden"
          disabled={busy}
          onChange={onChange}
        />
      </label>
    </main>
  );
}
