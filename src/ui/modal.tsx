"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";
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
 *
 * ## The element is the source of truth
 *
 * Every dismissal — the close button, a backdrop click, Escape — goes through
 * `el.close()`, and the resulting native `close` event is the ONLY thing that calls
 * `onClose`. Previously the close button called `onClose` directly, which set `open`
 * to false, which made the effect call `el.close()`, which fired the native event and
 * called `onClose` a second time. Every consumer's handler happened to be idempotent,
 * so it was invisible — but a handler that raised a toast, reset a form or navigated
 * would have done it twice.
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

  /**
   * Reconciled after EVERY render, not only when `open` flips.
   *
   * With `[open]` as the dependency the element could desync permanently: a browser
   * close (Escape) sets `el.open = false` and fires `onClose`, but if a consumer's
   * handler does not unconditionally clear `open` — a guarded "don't close while
   * saving", a confirm-before-discard, a deferred transition — then `open` stayed true
   * against a closed element, the dependency never changed again, and nothing ever
   * called `showModal()`. The dialog became unopenable with no error and no recovery
   * short of a reload. Reconciling every render makes `open` mean what it says.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // `showModal()` focuses the first focusable descendant, which is the close button
      // in the header — so every dialog opened on "dismiss this". A consumer's
      // `autoFocus` cannot win the race: the dialog is `display: none` when React
      // commits, so React's imperative focus is a no-op, and `showModal()` runs after.
      // `data-autofocus` is the supported way to name the field that should receive it.
      el.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  });

  /**
   * Closed on unmount, before the element leaves the DOM.
   *
   * A <dialog> removed while open never runs the spec's close steps, so focus is never
   * returned to the trigger and the keyboard user is dropped at the top of the
   * document. This is reachable: a consumer whose state change swaps out the branch
   * holding the dialog unmounts it mid-open. `useLayoutEffect` because a passive
   * cleanup runs after React has already detached the node, and closing a detached
   * dialog restores nothing.
   */
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (el?.open) el.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal modal-${size}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === ref.current) ref.current?.close();
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
        <button
          type="button"
          className="icon-btn"
          onClick={() => ref.current?.close()}
          aria-label="Close dialog"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      {/*
        Mounted only while open. A permanently-mounted body meant a form kept the value
        typed into an abandoned attempt AND the red notice from a submit the viewer had
        already walked away from: edit a product, get a VERSION_CONFLICT, press Escape,
        reopen — and the stale text and stale error were both still there, describing an
        attempt that no longer existed.

        Note for consumers: this resets the FORM, not a `useActionState` living in the
        parent. A form whose action state must reset too has to live in a child rendered
        here, so it unmounts with the body.

        `tabIndex={0}` because the body scrolls: a scroll container with no focusable
        content in it cannot be scrolled by keyboard at all (WCAG 2.1.1).
      */}
      <div className="modal-body" tabIndex={0}>
        {open ? children : null}
      </div>

      {footer ? <div className="modal-foot">{footer}</div> : null}
    </dialog>
  );
}

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * This is a client component, but Next still renders it on the server, where React
 * warns that `useLayoutEffect` does nothing. The choice is made once per environment,
 * so the hook order is stable.
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The confirmation shape for consequential actions: warning icon, what will
 * happen, the record it will happen to, and the action itself — which the caller
 * supplies as `children` so a server-action form (with its hidden fields and
 * pending state) stays the thing that actually commits. Backdrop click closes:
 * there is nothing to lose but the decision.
 *
 * `notice` is where the committing action's own failure goes. Without it, a rejected
 * confirm (deactivating the last active QA Lead, say) rendered its explanation on the
 * page BEHIND the backdrop — so the button appeared to do nothing at all, and the
 * reason sat two layers back. The buttons live in the real `.modal-foot` rather than
 * an inline-styled row inside the body, so they stay put instead of scrolling away.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  recordName,
  notice,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  recordName?: string;
  /** The action's `FormNotice`. Belongs here, not on the page under the backdrop. */
  notice?: React.ReactNode;
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
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {children}
        </>
      }
    >
      {notice}
      {recordName ? (
        <p>
          <span className="bid">{recordName}</span>
        </p>
      ) : null}
    </Modal>
  );
}
