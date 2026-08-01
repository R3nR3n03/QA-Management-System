"use client";

import { useEffect, useId, useRef } from "react";
import { TriangleAlert, X } from "lucide-react";

/**
 * The application's one modal primitive, built on the native <dialog> element —
 * which supplies the hard parts by specification: focus is trapped in the top
 * layer, the page behind becomes inert, Escape closes (the `cancel` event), and
 * focus returns to the trigger on close. This component adds the design system:
 * sizes, sticky header/footer with a scrollable body, title/description wiring
 * for assistive tech, and the 200ms motion voice.
 *
 * Backdrop clicks close only when `closeOnBackdrop` is set — entry forms default
 * to NOT closing, because losing typed input to a stray click is worse than an
 * extra press of Escape. The dialog itself has zero padding, so a click that
 * lands on the element (rather than its children) can only be the backdrop.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  size = "md",
  closeOnBackdrop = false,
  children,
  footer
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  closeOnBackdrop?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal modal-${size}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        {icon ? <span className="modal-icon" aria-hidden>{icon}</span> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id={titleId} style={{ margin: 0, fontSize: 17 }}>
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="muted" style={{ margin: "2px 0 0" }}>
              {description}
            </p>
          ) : null}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="modal-body">{children}</div>

      {footer ? <div className="modal-foot">{footer}</div> : null}
    </dialog>
  );
}

/**
 * The confirmation shape for consequential actions: warning icon, what will
 * happen, the record it will happen to, and the action itself — which the caller
 * supplies as `children` so a server-action form (with its hidden fields and
 * pending state) stays the thing that actually commits. Backdrop click closes:
 * there is nothing to lose but the decision.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  recordName,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  recordName?: string;
  children: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      icon={<TriangleAlert size={20} aria-hidden />}
      size="sm"
      closeOnBackdrop
    >
      {recordName ? (
        <p style={{ marginBottom: "var(--sp-4)" }}>
          <span className="bid">{recordName}</span>
        </p>
      ) : null}
      <div style={{ display: "flex", gap: "var(--sp-3)", justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        {children}
      </div>
    </Modal>
  );
}
