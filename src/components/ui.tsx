"use client";
import clsx from "clsx";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { X, Loader2, AlertTriangle, Inbox } from "lucide-react";
import { CLASS_LABELS, type Classification } from "@/lib/types";

export function Button({ variant = "primary", size = "md", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" }) {
  return (
    <button
      {...p}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "bg-blue-700 text-white hover:bg-blue-800",
        variant === "secondary" && "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        variant === "ghost" && "text-slate-600 hover:bg-slate-200",
        className,
      )}
    />
  );
}

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={clsx("rounded-lg border border-slate-200 bg-white shadow-sm", className)}>{children}</div>
);
export const CardHeader = ({ title, action }: { title: ReactNode; action?: ReactNode }) => (
  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
    <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
    {action}
  </div>
);

const inputCls = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600";
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={clsx(inputCls, p.className)} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={clsx(inputCls, "pr-8", p.className)} />;
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={clsx(inputCls, p.className)} />;
export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="block space-y-1">
    <span className="text-xs font-medium text-slate-600">{label}</span>
    {children}
    {hint && <span className="block text-xs text-slate-400">{hint}</span>}
  </label>
);

const CLASS_STYLE: Record<Classification, string> = {
  FORWARDED: "bg-emerald-100 text-emerald-800",
  NOT_USEFUL: "bg-amber-100 text-amber-800",
  DUPLICATE: "bg-violet-100 text-violet-800",
  PENDING_REVIEW: "bg-orange-100 text-orange-800",
  OTHER: "bg-slate-200 text-slate-700",
};
export const CLASS_COLORS: Record<Classification, string> = {
  FORWARDED: "#059669", NOT_USEFUL: "#d97706", DUPLICATE: "#7c3aed", PENDING_REVIEW: "#f97316", OTHER: "#64748b",
};

export const Badge = ({ className, children }: { className?: string; children: ReactNode }) => (
  <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)}>{children}</span>
);
export const ClassBadge = ({ value }: { value: string }) => (
  <Badge className={CLASS_STYLE[value as Classification] ?? "bg-slate-100"}>{CLASS_LABELS[value as Classification] ?? value}</Badge>
);
export const ConfBadge = ({ value, threshold = 75 }: { value: number; threshold?: number }) => (
  <Badge className={value >= threshold ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}>{value}%</Badge>
);

export const Spinner = ({ label = "Loading…" }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>
);
export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-red-700">
    <AlertTriangle className="h-6 w-6" /> <p>{message}</p>
    {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>}
  </div>
);
export const EmptyState = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <div className="flex flex-col items-center gap-2 p-10 text-center">
    <Inbox className="h-8 w-8 text-slate-300" />
    <p className="text-sm font-medium text-slate-600">{title}</p>
    {hint && <p className="max-w-md text-xs text-slate-400">{hint}</p>}
    {action}
  </div>
);

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" onMouseDown={onClose}>
      <div role="dialog" aria-modal className={clsx("w-full rounded-lg bg-white shadow-xl", wide ? "max-w-3xl" : "max-w-lg")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export const Th = ({ children, sort, active, dir, onSort, className }: { children: ReactNode; sort?: string; active?: boolean; dir?: "asc" | "desc"; onSort?: (s: string) => void; className?: string }) => (
  <th
    className={clsx("whitespace-nowrap bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500", sort && "cursor-pointer select-none hover:text-slate-800", className)}
    onClick={sort && onSort ? () => onSort(sort) : undefined}
  >
    {children}{active ? (dir === "asc" ? " ▲" : " ▼") : ""}
  </th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={clsx("border-t border-slate-100 px-3 py-2 text-sm align-top", className)}>{children}</td>
);

// ----- toasts -----
type Toast = { id: number; kind: "ok" | "error"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed right-4 bottom-4 z-[60] space-y-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={clsx("max-w-sm rounded-md px-4 py-2.5 text-sm text-white shadow-lg", t.kind === "ok" ? "bg-emerald-700" : "bg-red-700")}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Confirmation dialog; `requireText` makes the user type a word before a destructive action is enabled. */
export function ConfirmModal({ open, onClose, title, children, confirmLabel, onConfirm, requireText, danger = true, busy }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void | Promise<void>;
  requireText?: string; danger?: boolean; busy?: boolean;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => { if (!open) setTyped(""); }, [open]);
  const ok = !requireText || typed.trim() === requireText;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-3 text-sm">
        {children}
        {requireText && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">Type <code className="rounded bg-slate-100 px-1">{requireText}</code> to confirm</span>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={`Type ${requireText} to confirm`} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600" />
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} disabled={!ok || busy} onClick={() => onConfirm()}>{busy ? "Working…" : confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}
