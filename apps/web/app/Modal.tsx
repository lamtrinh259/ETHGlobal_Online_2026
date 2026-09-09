"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useBodyScrollLock } from "./useBodyScrollLock";
import { useModalEscape } from "./useModalEscape";

/**
 * A dialog for work that interrupts: signing a record is a decision, not a section of a page. Escape
 * and the backdrop close it, the page behind it stops scrolling, and focus moves inside.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useBodyScrollLock(true);
  useModalEscape(onClose, true);
  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div className="modal-back" onClick={onClose} data-testid="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close" className="modal-x">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
