"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type Tone = "info" | "done" | "warn" | "danger";
interface Toast {
  id: number;
  msg: string;
  tone: Tone;
}

const ToastCtx = createContext<(msg: string, tone?: Tone) => void>(() => {});

/** Hook notifikasi kecil — paling gampang: const toast = useToast(); toast("beres", "done") */
export function useToast() {
  return useContext(ToastCtx);
}

const TONE_STYLE: Record<Tone, string> = {
  info: "border-accent/40 text-text",
  done: "border-done/40 text-done",
  warn: "border-warn/40 text-warn",
  danger: "border-danger/40 text-danger",
};
const TONE_DOT: Record<Tone, string> = {
  info: "bg-accent",
  done: "bg-done",
  warn: "bg-warn",
  danger: "bg-danger",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((msg: string, tone: Tone = "info") => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* fixed di bawah, di atas bottom nav mobile (pb-safe disisain lewat bottom-16) */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex flex-col items-center gap-1.5 px-4 max-md:bottom-20"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-toast pointer-events-auto flex w-full max-w-md items-center gap-2.5 rounded-full border bg-surface-2/95 px-4 py-2.5 text-[13px] shadow-lg ${TONE_STYLE[t.tone]}`}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[t.tone]}`} />
            <span className="text-text">{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}