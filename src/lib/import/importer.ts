import { getDb } from "../db";
import { getSettings, saveSettings } from "../settings";
import { logAudit } from "../audit";
import { parseEmails } from "../parser";
import { analyzeMonth } from "./analyze";
import { MONTH_NAMES } from "../types";
import { ImportError, runImport, type ImportSummary } from "./core";
import type { ImportItem } from "./types";

export { ImportError, fingerprint, type ImportSummary } from "./core";

/** Imports one pasted batch. Additive: existing emails are never modified or removed. */
export async function importBatch(input: { year: number; month: number; text: string }): Promise<ImportSummary> {
  const { year, month } = input;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new ImportError("Select a valid year and month.");
  if (!input.text || !input.text.trim()) throw new ImportError("Nothing to analyze: paste your Outlook emails first.");
  if (input.text.length > 25_000_000) throw new ImportError("The pasted content is too large (limit 25 MB). Paste in smaller batches.");

  const settings = await getSettings();
  let result = parseEmails(input.text, { dateOrder: settings.dateOrder });
  const warnings = [...result.warnings];
  if (!result.emails.length) throw new ImportError(warnings[0] ?? "No emails could be recognised in the pasted text.");

  // numeric dates: if the paste itself proves the order (e.g. 25/04 can only be day/month), trust the evidence
  // over the setting, remember it, and stop flagging ambiguous dates; otherwise ambiguous dates that could change
  // the month are flagged for review.
  const ev = result.emails.map((e) => e.dateOrderEvidence).filter(Boolean) as ("DMY" | "MDY")[];
  const dmy = ev.filter((x) => x === "DMY").length, mdy = ev.length - dmy;
  let order = settings.dateOrder;
  let resolved = settings.dateOrderLearned;
  if (dmy && mdy) {
    warnings.push(`Dates in this paste mix day/month and month/day formats (${dmy} vs ${mdy} unambiguous dates). Using “${settings.dateOrder}” from Settings — check the Review queue for date warnings.`);
    resolved = false;
  } else if (ev.length) {
    order = ev[0];
    if (order !== settings.dateOrder) {
      warnings.push(`Dates in this paste are clearly ${order === "DMY" ? "day/month/year" : "month/day/year"}; that order was used instead of the Settings value (${settings.dateOrder}) and saved to Settings.`);
      result = parseEmails(input.text, { dateOrder: order });
    }
    if (order !== settings.dateOrder || !settings.dateOrderLearned) await saveSettings({ dateOrder: order, dateOrderLearned: true });
    resolved = true;
  }
  const parsed = result.emails;
  if (resolved) for (const p of parsed) p.sentAtAlt = null;
  const ambiguous = parsed.filter((e) => e.sentAtAlt).length;
  if (ambiguous) warnings.push(`${ambiguous} date(s) have an ambiguous day/month order (no date in this paste proves it) and were read as “${order === "DMY" ? "day/month" : "month/day"}”. Those that could fall in another month are flagged in Review.`);

  // wrong-month safeguard: most dated emails belong to a different month than the one selected
  const dated = parsed.filter((p) => p.sentAt);
  if (dated.length >= 3) {
    const tally = new Map<string, number>();
    for (const p of dated) { const k = `${p.sentAt!.getUTCFullYear()}-${p.sentAt!.getUTCMonth() + 1}`; tally.set(k, (tally.get(k) ?? 0) + 1); }
    const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    const [ty, tm] = top.split("-").map(Number);
    if ((ty !== year || tm !== month) && n / dated.length >= 0.5) {
      warnings.push(`Most dated emails (${n} of ${dated.length}) are from ${MONTH_NAMES[tm - 1]} ${ty}, not the selected ${MONTH_NAMES[month - 1]} ${year}. If you chose the wrong month, delete this batch in the Batches table and paste again with the right month.`);
    }
  }

  return runImport(parsed.map((p): ImportItem => ({ parsed: p })), { source: "Paste", year, month, monthMode: "selected", warnings, total: parsed.length });
}

export async function deleteBatch(id: string) {
  const db = await getDb();
  const b = db.batches.get(id);
  if (!b) throw new ImportError("Batch not found.");
  const gone = new Set(db.emails.all().filter((e) => e.batchId === id).map((e) => e.id));
  // other emails that pointed to a deleted one lose that link (the analysis below re-evaluates them)
  const relinked = db.emails.all()
    .filter((e) => !gone.has(e.id) && ((e.duplicateOfId && gone.has(e.duplicateOfId)) || (e.possibleDuplicateOfId && gone.has(e.possibleDuplicateOfId))))
    .map((e) => ({ ...e, duplicateOfId: e.duplicateOfId && gone.has(e.duplicateOfId) ? null : e.duplicateOfId, possibleDuplicateOfId: e.possibleDuplicateOfId && gone.has(e.possibleDuplicateOfId) ? null : e.possibleDuplicateOfId }));
  await db.apply([{ table: "batches", delete: [id] }, { table: "emails", delete: [...gone], put: relinked }, { table: "raw", delete: [...gone] }]);
  await logAudit("BATCH_DELETED", "Batch", id, `Batch ${b.number} deleted (${gone.size} emails)`, { year: b.year, month: b.month });
  await analyzeMonth(b.year, b.month);
}
