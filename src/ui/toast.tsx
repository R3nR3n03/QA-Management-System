"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";

/**
 * Success confirmation for modal flows. When a modal closes itself on success,
 * the form — and its inline notice — leaves the screen with it, so the toast is
 * what tells the user the save landed. Deliberately narrow: successes only.
 * Failures stay inline next to the field that caused them (`FormNotice`), where
 * they can name the field and survive until fixed — a rule this file exists to
 * protect, not to erode.
 *
 * The stack is a polite live region announced once per message; toasts dismiss
 * themselves after four seconds and never carry actions.
 */
type Toast = { id: number; message: string };

const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const push = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            <CheckCircle2 size={16} aria-hidden />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
