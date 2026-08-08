"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * The drag handle between the tree and the detail panel.
 *
 * The explorer was a fixed 300px. That is a comfortable width for `MOD001 Dashboard` and
 * a cruel one for `MOD006 System Configuration and Audit`, which truncates at the third
 * word — and every level of indent takes another 18px from the label. Truncation is not a
 * cosmetic problem in a catalogue whose whole job is telling near-identical records apart:
 * `Reports` and `Reports Syncronization` are the same fourteen characters.
 *
 * A width is a viewer preference about their own screen, not a property of the catalogue,
 * so it lives in `localStorage` rather than the URL — nobody wants to send a colleague a
 * link that also resizes their panel. That does mean the applied width lands after
 * hydration; the CSS default is a sensible width rather than zero, so what moves is a
 * panel getting wider, not a layout assembling itself.
 *
 * Keyboard-operable, because a mouse-only resize is a control some people simply do not
 * have. `role="separator"` with `aria-valuenow` is the documented pattern for a window
 * splitter, and the arrow keys move it in 16px steps.
 */

/** Bounds. Narrower than MIN and the deepest label is unreadable; wider than MAX and the
 *  detail panel — which holds the record you are actually reading — starts to suffer. */
const MIN_WIDTH = 240;
const MAX_WIDTH = 640;
const STEP = 16;
const STORAGE_KEY = "qams.catalogue.explorerWidth";
const CSS_VAR = "--explorer-w";

function clamp(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

export function ExplorerResizer() {
  const handle = useRef<HTMLDivElement>(null);
  /** The `.cat-screen` element that owns the custom property. */
  const screen = useRef<HTMLElement | null>(null);
  const width = useRef<number>(0);

  const apply = useCallback((next: number, remember: boolean) => {
    const value = clamp(next);
    width.current = value;
    screen.current?.style.setProperty(CSS_VAR, `${value}px`);
    handle.current?.setAttribute("aria-valuenow", String(value));
    if (remember) {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(value));
      } catch {
        // Private mode, or a storage quota. A width that does not persist is a smaller
        // problem than a screen that throws while you drag it.
      }
    }
  }, []);

  useEffect(() => {
    screen.current = handle.current?.closest(".cat-screen") as HTMLElement | null;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    const parsed = Number(stored);
    // No stored width means keep the stylesheet's default rather than imposing MIN.
    if (Number.isFinite(parsed) && parsed > 0) apply(parsed, false);
    else if (screen.current) {
      const current = Number.parseFloat(
        getComputedStyle(screen.current).getPropertyValue(CSS_VAR)
      );
      width.current = Number.isFinite(current) ? current : MIN_WIDTH;
      handle.current?.setAttribute("aria-valuenow", String(Math.round(width.current)));
    }
  }, [apply]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Only the primary button drags. A right-click here is a context menu, not a resize.
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startWidth = width.current;
    const node = event.currentTarget;

    // Capture, so a fast drag that leaves the 6px handle keeps resizing rather than
    // stopping dead the moment the pointer outruns it.
    node.setPointerCapture(event.pointerId);
    node.dataset.dragging = "";
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (move: PointerEvent) => apply(startWidth + (move.clientX - startX), false);

    const onUp = () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
      delete node.dataset.dragging;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      // Written once at the end, not on every pointer move.
      apply(width.current, true);
    };

    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerup", onUp);
    node.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "ArrowLeft"
        ? width.current - STEP
        : event.key === "ArrowRight"
          ? width.current + STEP
          : event.key === "Home"
            ? MIN_WIDTH
            : event.key === "End"
              ? MAX_WIDTH
              : null;
    if (next === null) return;
    // Arrow keys would otherwise scroll the panel the handle is sitting against.
    event.preventDefault();
    apply(next, true);
  };

  return (
    <div
      ref={handle}
      className="cat-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the catalogue browser"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
