import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(null);

let nextId = 1;

/**
 * Lightweight snackbar system with optional Undo-style actions.
 *   const toast = useToast();
 *   toast.show("Moved to Front wall · B3", { actionLabel: "Undo", onAction });
 *   toast.error("Couldn't save. Please try again.");
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
  }, []);

  const show = useCallback(
    (message, { actionLabel, onAction, tone = "info", duration } = {}) => {
      const id = nextId++;
      const ms = duration ?? (actionLabel ? 6000 : 3500);
      setToasts((prev) => [...prev.slice(-2), { id, message, actionLabel, onAction, tone }]);
      timersRef.current[id] = setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss]
  );

  const error = useCallback(
    (message, opts = {}) => show(message, { ...opts, tone: "error", duration: opts.duration ?? 5000 }),
    [show]
  );

  return (
    <ToastContext.Provider value={{ show, error, dismiss }}>
      {children}
      {/* Above the bottom safe area so Safari's toolbar never covers it */}
      <div
        aria-live="polite"
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3 shadow-xl text-sm font-medium text-white ${
              t.tone === "error" ? "bg-red-600" : "bg-gray-900/95"
            }`}
          >
            <span className="flex-1">{t.message}</span>
            {t.actionLabel && (
              <button
                onClick={() => {
                  dismiss(t.id);
                  t.onAction?.();
                }}
                className="shrink-0 min-h-[44px] px-3 -my-2 rounded-lg font-bold text-yellow-300"
              >
                {t.actionLabel}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="shrink-0 min-h-[44px] min-w-[32px] -my-2 -mr-2 rounded-lg text-white/70"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
