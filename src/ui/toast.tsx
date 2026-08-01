"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, X } from "lucide-react";

/**
 * Success confirmation for modal flows. When a modal closes itself on success,
 * the form — and its inline notice — leaves the screen with it, so the toast is
 * what tells the user the save landed. Deliberately narrow: successes only.
 * Failures stay inline next to the field that caused them (`FormNotice`), where
 * they can name the field and survive until fixed — a rule this file exists to
 * protect, not to erode.
 *
 * The stack is a polite live region announced once per message. Toasts dismiss
 * themselves after four seconds, but the timer pauses while the pointer or focus
 * is on the toast, and every toast carries an explicit dismiss button — auto-
 * disappearing text a reader cannot pause fails WCAG 2.2.1. Never any other action.
 */
type Toast = { id: number; message: string };

const AUTO_DISMISS_MS = 4000;

const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const arm = useCallback(
    (id: number) => {
      const timer = timers.current.get(id);
      if (timer) clearTimeout(timer);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
      );
    },
    [dismiss]
  );

  const pause = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message }]);
      arm(id);
    },
    [arm]
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="toast"
            onMouseEnter={() => pause(toast.id)}
            onMouseLeave={() => arm(toast.id)}
            onFocus={() => pause(toast.id)}
            onBlur={() => arm(toast.id)}
          >
            <CheckCircle2 size={16} aria-hidden />
            <span>{toast.message}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Dismiss notification"
              onClick={() => dismiss(toast.id)}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
