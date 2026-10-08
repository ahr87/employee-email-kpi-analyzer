"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { MONTH_NAMES } from "@/lib/types";
import { getSettings } from "@/lib/settings";
import { monthsWithData } from "@/lib/reports/aggregate";
import { Select } from "./ui";

interface Ctx { year: number; month: number; set: (y: number, m: number) => void; ready: boolean }
const MonthCtx = createContext<Ctx>({ year: 2026, month: 1, set: () => {}, ready: false });
export const useMonth = () => useContext(MonthCtx);
const KEY = "eka.month";

export function MonthProvider({ children }: { children: ReactNode }) {
  const now = new Date();
  const [state, setState] = useState({ year: now.getFullYear(), month: now.getMonth() + 1, ready: false });
  useEffect(() => {
    (async () => {
      let next = { year: now.getFullYear(), month: now.getMonth() + 1 };
      try {
        let saved: { year?: number; month?: number } | null = null;
        try { saved = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { /* storage unavailable */ }
        if (saved?.year && saved?.month) next = { year: saved.year, month: saved.month };
        else {
          const s = await getSettings();
          if (s.defaultMonth) next = s.defaultMonth;
          else {
            const m = await monthsWithData();
            if (m[0]) next = { year: m[0].year, month: m[0].month };
          }
        }
      } catch { /* local database not readable yet: fall back to the current month */ }
      setState({ ...next, ready: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = (year: number, month: number) => {
    setState({ year, month, ready: true });
    try { localStorage.setItem(KEY, JSON.stringify({ year, month })); } catch { /* ignore */ }
  };
  return <MonthCtx.Provider value={{ ...state, set }}>{children}</MonthCtx.Provider>;
}

export function MonthPicker({ year, month, onChange }: { year: number; month: number; onChange: (y: number, m: number) => void }) {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => thisYear + 1 - i);
  if (!years.includes(year)) years.push(year);
  return (
    <div className="flex items-center gap-2">
      <Select aria-label="Year" value={year} onChange={(e) => onChange(Number(e.target.value), month)} style={{ width: "7.5rem" }}>
        {years.sort((a, b) => b - a).map((y) => <option key={y}>{y}</option>)}
      </Select>
      <Select aria-label="Month" value={month} onChange={(e) => onChange(year, Number(e.target.value))} style={{ width: "10rem" }}>
        {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </Select>
    </div>
  );
}

export function GlobalMonthPicker() {
  const { year, month, set } = useMonth();
  return <MonthPicker year={year} month={month} onChange={set} />;
}
