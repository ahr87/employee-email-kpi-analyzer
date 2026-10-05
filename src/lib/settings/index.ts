import { z } from "zod";
import { DEFAULT_KPI_CONFIG, type KpiConfig } from "../kpi/engine";
import { DEFAULT_PHRASES, DEFAULT_TEAM_KEYWORDS } from "../classification/phrases";
import { prisma } from "../database/client";
import { logAudit } from "../audit";

const classNum = z.number().min(0).max(1);

export const nmcEntrySchema = z.object({
  address: z.string().trim().min(3).max(200), // full address, or @domain
  label: z.string().trim().max(80).default(""),
  enabled: z.boolean().default(true),
});
export type NmcEntry = z.infer<typeof nmcEntrySchema>;

const phraseList = z.array(z.string().trim().min(1).max(200)).max(500);

export const settingsSchema = z.object({
  appName: z.string().min(1).max(80).default("Employee Email KPI Analyzer"),
  defaultMonth: z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) }).nullable().default(null),
  confidenceThreshold: z.number().int().min(0).max(100).default(75),
  similarityThreshold: z.number().int().min(30).max(100).default(80),
  duplicateWindowHours: z.number().int().min(1).max(720).default(48),
  dateOrder: z.enum(["DMY", "MDY"]).default("DMY"),
  /** true once a pasted date proved the order (e.g. 25/04); ambiguous numeric dates are then no longer flagged. */
  dateOrderLearned: z.boolean().default(false),
  /** Addresses or @domains of NMC staff: their replies/forwards are evidence, not employee emails. Old string[] values are upgraded. */
  nmcAddresses: z
    .preprocess((v) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? { address: x } : x)) : v), z.array(nmcEntrySchema))
    .default([]),
  /** Editable evidence phrases (English / Arabic). */
  phrases: z
    .object({ escalation: phraseList, notUseful: phraseList, duplicate: phraseList, useful: phraseList })
    .default(DEFAULT_PHRASES),
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
  const p = patch as Record<string, unknown>;
  // changing the order by hand means "not verified against real data yet"
  if (p.dateOrder !== undefined && p.dateOrder !== before.dateOrder && p.dateOrderLearned === undefined) p.dateOrderLearned = false;
  const next = settingsSchema.parse({ ...before, ...p });
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
