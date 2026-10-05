import type { Classification } from "../types";

/**
 * KPI engine — intentionally independent from classification.
 * It only receives FINAL classification counts and a configuration object, so the
 * formula can be changed in Settings (or replaced) without touching email analysis.
 *
 * Email VOLUME and email QUALITY are kept apart: the score is a quality score based on the
 * mix of outcomes; the number of emails is reported next to it and is never rewarded by itself.
 */
export interface KpiConfig {
  /** Quality value of one email per final classification (0..1). Score = weighted share * 100. */
  weights: Record<Classification, number>;
  /** How PENDING_REVIEW emails are handled: excluded from the score, or counted using weights.PENDING_REVIEW. */
  pendingMode: "exclude" | "weighted";
  /** Points deducted from the score per email of a class (applied after weighting). */
  penaltiesPerEmail: Partial<Record<Classification, number>>;
  /** Below this many scored emails the score is not computed (status INSUFFICIENT_DATA). */
  minimumEmails: number;
  /** Target score used for MEETS_TARGET / BELOW_TARGET. */
  target: number;
  /** Rating bands, highest first match wins. */
  thresholds: { excellent: number; good: number; fair: number };
}

export const DEFAULT_KPI_CONFIG: KpiConfig = {
  weights: { FORWARDED: 1, OTHER: 0.5, NOT_USEFUL: 0, DUPLICATE: 0, PENDING_REVIEW: 0 },
  pendingMode: "exclude",
  penaltiesPerEmail: { DUPLICATE: 0, NOT_USEFUL: 0 },
  minimumEmails: 1,
  target: 80,
  thresholds: { excellent: 90, good: 75, fair: 60 },
};

export type ClassCounts = Record<Classification, number>;
export const emptyCounts = (): ClassCounts => ({ FORWARDED: 0, NOT_USEFUL: 0, DUPLICATE: 0, PENDING_REVIEW: 0, OTHER: 0 });

export type KpiStatus = "MEETS_TARGET" | "BELOW_TARGET" | "INSUFFICIENT_DATA";
export type KpiRating = "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "N/A";

export interface KpiResult {
  total: number; // email volume (all final classes)
  scored: number; // emails that entered the score
  score: number | null; // 0-100 quality score
  rating: KpiRating;
  status: KpiStatus;
}

export function computeKpi(counts: ClassCounts, config: KpiConfig = DEFAULT_KPI_CONFIG): KpiResult {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const scored = total - (config.pendingMode === "exclude" ? counts.PENDING_REVIEW : 0);
  if (scored < Math.max(1, config.minimumEmails)) {
    return { total, scored, score: null, rating: "N/A", status: "INSUFFICIENT_DATA" };
  }
  let points = 0;
  for (const c of Object.keys(counts) as Classification[]) {
    if (c === "PENDING_REVIEW" && config.pendingMode === "exclude") continue;
    points += counts[c] * (config.weights[c] ?? 0);
  }
  let score = (points / scored) * 100;
  for (const [c, pen] of Object.entries(config.penaltiesPerEmail) as [Classification, number][]) {
    score -= (pen ?? 0) * (counts[c] ?? 0);
  }
  score = Math.max(0, Math.min(100, Math.round(score * 10) / 10));
  const t = config.thresholds;
  const rating: KpiRating = score >= t.excellent ? "EXCELLENT" : score >= t.good ? "GOOD" : score >= t.fair ? "FAIR" : "POOR";
  return { total, scored, score, rating, status: score >= config.target ? "MEETS_TARGET" : "BELOW_TARGET" };
}
