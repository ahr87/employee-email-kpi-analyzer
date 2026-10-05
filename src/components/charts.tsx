"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CLASSES, CLASS_LABELS, MONTH_NAMES } from "@/lib/types";
import { CLASS_COLORS } from "./ui";

type Counts = Record<(typeof CLASSES)[number], number>;

export function ClassPie({ counts }: { counts: Counts }) {
  const data = CLASSES.map((c) => ({ name: CLASS_LABELS[c], value: counts[c], key: c })).filter((d) => d.value > 0);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
          {data.map((d) => <Cell key={d.key} fill={CLASS_COLORS[d.key]} />)}
        </Pie>
        <Tooltip /><Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function EmployeeStackedBar({ rows }: { rows: { name: string; counts: Counts }[] }) {
  const data = rows.map((r) => ({ name: r.name, ...r.counts }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(240, data.length * 30 + 60)}>
      <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
        <Tooltip /><Legend />
        {CLASSES.map((c) => <Bar key={c} dataKey={c} name={CLASS_LABELS[c]} stackId="a" fill={CLASS_COLORS[c]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendStack({ months }: { months: ({ month: number; total: number; score: number | null } & Counts)[] }) {
  const data = months.map((m) => ({ ...m, label: MONTH_NAMES[m.month - 1].slice(0, 3) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" /><YAxis allowDecimals={false} /><Tooltip /><Legend />
        {CLASSES.map((c) => <Bar key={c} dataKey={c} name={CLASS_LABELS[c]} stackId="a" fill={CLASS_COLORS[c]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VolumeVsQuality({ months }: { months: { month: number; total: number; score: number | null }[] }) {
  const data = months.map((m) => ({ label: MONTH_NAMES[m.month - 1].slice(0, 3), Emails: m.total, "KPI score": m.score }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" />
        <YAxis yAxisId="l" allowDecimals={false} /><YAxis yAxisId="r" orientation="right" domain={[0, 100]} />
        <Tooltip /><Legend />
        <Line yAxisId="l" type="linear" dataKey="Emails" stroke="#64748b" strokeWidth={2} />
        <Line yAxisId="r" type="linear" dataKey="KPI score" stroke="#1d4ed8" strokeWidth={2} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
