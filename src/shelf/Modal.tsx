import { useEffect, useRef, useState, type ReactNode } from "react";

// Open modals, oldest first. Escape closes only the topmost one, wherever focus is.
const stack: Array<{ close: () => void; focus: () => void }> = [];

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || stack.length === 0) return;
  e.preventDefault();
  stack[stack.length - 1].close();
}

export interface ModalProps {
  /** Accessible name of the dialog. */
  label: string;
  onClose: () => void;
  className?: string;
  /** "drawer" slides in from the left as a full-height panel; behaviour is the same. */
  variant?: "dialog" | "drawer";
  children: ReactNode;
}

/** A themed modal dialog: focus moves in on open and back on close; Escape or a backdrop click closes. */
export function Modal({ label, onClose, className, variant = "dialog", children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Captured at first render: under StrictMode the effect runs twice, after focus already moved in.
  const [previous] = useState(() => document.activeElement);

  useEffect(() => {
    const entry = { close: () => closeRef.current(), focus: () => ref.current?.focus() };
    stack.push(entry);
    if (stack.length === 1) window.addEventListener("keydown", onKeyDown);
    ref.current?.focus();
    return () => {
      stack.splice(stack.indexOf(entry), 1);
      if (stack.length === 0) window.removeEventListener("keydown", onKeyDown);
      // Another modal still open beneath (e.g. the drawer under "Make room"): focus stays in it.
      if (stack.length > 0) stack[stack.length - 1].focus();
      else if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) previous.focus();
    };
  }, [previous]);

  return (
    <div
      className={variant === "drawer" ? "modal-backdrop drawer-backdrop" : "modal-backdrop"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={["modal", variant === "drawer" && "drawer", className].filter(Boolean).join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
