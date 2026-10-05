import { z } from "zod";
import { DEFAULT_KPI_CONFIG, type KpiConfig } from "../kpi/engine";
import { DEFAULT_TEAM_KEYWORDS } from "../classification/phrases";
import { prisma } from "../database/client";
import { logAudit } from "../audit";

const classNum = z.number().min(0).max(1);

export const settingsSchema = z.object({
  appName: z.string().min(1).max(80).default("Employee Email KPI Analyzer"),
  defaultMonth: z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) }).nullable().default(null),
  confidenceThreshold: z.number().int().min(0).max(100).default(75),
  similarityThreshold: z.number().int().min(30).max(100).default(80),
  duplicateWindowHours: z.number().int().min(1).max(720).default(48),
  dateOrder: z.enum(["DMY", "MDY"]).default("DMY"),
  /** Addresses or @domains of NMC staff: their replies/forwards are evidence, not employee emails. */
  nmcAddresses: z.array(z.string()).default([]),
  teamKeywords: z.array(z.string()).default(DEFAULT_TEAM_KEYWORDS),
  aiAssisted: z.boolean().default(false), // reserved: future optional AI mode, always off by default
  kpi: z
    .object({
      weights: z.object({ FORWARDED: classNum, NOT_USEFUL: classNum, DUPLICATE: classNum, PENDING_REVIEW: classNum, OTHER: classNum }),
      pendingMode: z.enum(["exclude", "weighted"]),
      penaltiesPerEmail: z.object({ FORWARDED: z.number().min(0).optional(), NOT_USEFUL: z.number().min(0).optional(), DUPLICATE: z.number().min(0).optional(), PENDING_REVIEW: z.number().min(0).optional(), OTHER: z.number().min(0).optional() }),
      minimumEmails: z.number().int().min(1).max(1000),
      target: z.number().min(0).max(100),
      thresholds: z.object({ excellent: z.number().min(0).max(100), good: z.number().min(0).max(100), fair: z.number().min(0).max(100) }),
    })
    .default(DEFAULT_KPI_CONFIG as KpiConfig),
});

export type AppSettings = z.infer<typeof settingsSchema>;
const KEY = "app";

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  let stored: unknown = {};
  try { stored = row ? JSON.parse(row.value) : {}; } catch { stored = {}; }
  const parsed = settingsSchema.safeParse(stored);
  return parsed.success ? parsed.data : settingsSchema.parse({});
}

export async function saveSettings(patch: unknown): Promise<AppSettings> {
  const before = await getSettings();
  const next = settingsSchema.parse({ ...before, ...(patch as object) });
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
  const changed = (Object.keys(next) as (keyof AppSettings)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]));
  if (changed.length) {
    await logAudit("SETTINGS_CHANGED", "Setting", KEY, `Settings changed: ${changed.join(", ")}`, {
      before: Object.fromEntries(changed.map((k) => [k, before[k]])),
      after: Object.fromEntries(changed.map((k) => [k, next[k]])),
    });
  }
  return next;
}
