import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type ToastKind = "success" | "info" | "error" | "join" | "leave";
type Toast = { id: number; kind: ToastKind; text: string };

const ToastContext = createContext<(kind: ToastKind, text: string) => void>(() => undefined);

const ICONS: Record<ToastKind, string> = { success: "✓", info: "i", error: "!", join: "+", leave: "–" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "info" ? 5000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            <span className="toast__icon">{ICONS[t.kind]}</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
