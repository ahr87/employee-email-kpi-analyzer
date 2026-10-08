"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { BarChart3, ClipboardCheck, FileText, LayoutDashboard, Mail, Search, Settings, Users, ClipboardPaste } from "lucide-react";
import { GlobalMonthPicker, MonthProvider } from "./month";
import { ToastProvider } from "./ui";
import { getDb, storageWarning } from "@/lib/db";
import { assetPath } from "@/lib/config";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/emails", label: "Emails", icon: Mail },
  { href: "/review", label: "Review", icon: ClipboardCheck },
  { href: "/employees", label: "Employees", icon: Users },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const onExternal = () => setStale(true);
    window.addEventListener("ekpi:external-change", onExternal);
    getDb().then(() => setWarning(storageWarning())).catch((e: Error) => setWarning(`Local storage could not be opened (${e.message}).`));
    // offline support (production build only; never in `next dev`)
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register(assetPath("/sw.js"), { scope: assetPath("/") }).catch(() => undefined);
    }
    return () => window.removeEventListener("ekpi:external-change", onExternal);
  }, []);
  return (
    <ToastProvider>
      <MonthProvider>
        <div className="flex min-h-screen">
          <aside className="hidden w-56 shrink-0 flex-col bg-slate-900 p-4 text-slate-200 md:flex">
            <Link href="/" className="mb-6 flex items-center gap-2 text-white">
              <BarChart3 className="h-5 w-5 text-blue-400" />
              <span className="text-sm leading-tight font-semibold">Email KPI<br />Analyzer</span>
            </Link>
            <nav className="space-y-1">
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? path === "/" : path.startsWith(href);
                return (
                  <Link key={href} href={href} className={clsx("flex items-center gap-2.5 rounded-md px-3 py-2 text-sm", active ? "bg-blue-700 text-white" : "hover:bg-slate-800")}>
                    <Icon className="h-4 w-4" />{label}
                  </Link>
                );
              })}
            </nav>
            <p className="mt-auto text-[11px] leading-snug text-slate-500">Runs entirely in your browser. Emails are stored on this device only and never uploaded; Outlook is never contacted.</p>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
              <nav className="flex gap-1 md:hidden">
                {NAV.map(({ href, label }) => <Link key={href} href={href} className="rounded px-2 py-1 text-xs hover:bg-slate-100">{label}</Link>)}
              </nav>
              <form
                className="relative min-w-52 flex-1 md:max-w-md"
                onSubmit={(e) => { e.preventDefault(); router.push(`/emails?q=${encodeURIComponent(q)}`); }}
              >
                <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                <input
                  value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee, subject, incident, service ID, location…"
                  className="w-full rounded-md border border-slate-300 py-2 pr-3 pl-9 text-sm outline-none focus:border-blue-600"
                />
              </form>
              <div className="ml-auto flex items-center gap-3">
                <GlobalMonthPicker />
                <Link href="/import" className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-800">
                  <ClipboardPaste className="h-4 w-4" /> Paste &amp; Analyze
                </Link>
              </div>
            </header>
            {stale && <div role="status" className="flex items-center gap-3 border-b border-blue-200 bg-blue-50 px-6 py-2 text-sm text-blue-900">The data was changed in another tab of this app. <button className="rounded border border-blue-300 bg-white px-2 py-0.5 hover:bg-blue-100" onClick={() => window.location.reload()}>Reload to see the latest</button></div>}
            {warning && <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-800">⚠ {warning} Without browser storage your data is kept only in memory and is lost when this tab closes — export a backup from Settings before leaving.</div>}
            <main className="flex-1 p-6">{children}</main>
          </div>
        </div>
      </MonthProvider>
    </ToastProvider>
  );
}
