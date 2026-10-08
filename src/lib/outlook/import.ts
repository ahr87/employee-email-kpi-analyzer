import { getDb } from "../db";
import { getSettings, saveSettings } from "../settings";
import { isNmcAddress, matchEmployee } from "../employees/matching";
import { DuplicateIndex, ImportError, runImport, type ImportSummary } from "../import/core";
import { yieldToUi, type ImportItem, type MonthMode, type ProgressFn } from "../import/types";
import { MONTH_NAMES } from "../types";
import { OutlookFileError, parseElement, streamExport, type ExportSource, type StreamInfo } from "./stream";
import { validateMessage, sourceMatches, OUTLOOK_SOURCE, type InvalidMessage } from "./schema";
import { prepareMessage } from "./prepare";

type Order = "DMY" | "MDY";

export interface OutlookPreview {
  filename: string;
  sizeBytes: number | null;
  encoding: string;
  exportedAt: string | null;
  source: string;
  total: number;
  valid: number;
  invalid: number;
  invalidList: InvalidMessage[];
  invalidTruncated: boolean;
  dateFrom: Date | null;
  dateTo: Date | null;
  uniqueSenders: number;
  uniqueConversations: number;
  /** messages sent by configured employees / distinct employees */
  employeeMessages: number;
  matchedEmployees: number;
  /** messages (and distinct senders) that are neither a configured employee nor an NMC address */
  otherSenderMessages: number;
  otherSenders: number;
  nmcMessages: number;
  duplicatesInDb: number;
  duplicatesInFile: number;
  months: { year: number; month: number; count: number }[];
  withQuotedHistory: number;
  withSignature: number;
  htmlOnly: number;
  repairedMessages: number;
  dateOrder: Order;
  dateOrderProven: boolean;
  ambiguousDates: number;
  warnings: string[];
}

interface ScanHooks { onBytes?: (read: number, total: number | null) => void }
type ScanEvent =
  | { type: "valid"; index: number; item: ImportItem; repaired: boolean; evidence: Order | null; ambiguous: boolean }
  | { type: "invalid"; invalid: InvalidMessage }
  | { type: "meta"; source: string | null; exportedAt: string | null };

/** Reads the export message by message: parse → validate → normalize. A bad message never stops the rest. */
async function* scan(file: ExportSource, order: Order, info: StreamInfo, hooks: ScanHooks = {}): AsyncGenerator<ScanEvent> {
  let source: string | null = null;
  let exportedAt: string | null = null;
  let checked = false;
  let n = 0;
  const check = () => {
    if (checked) return;
    if (source === null) return;
    checked = true;
    if (!sourceMatches(source)) throw new OutlookFileError(`This file was not written by the Outlook exporter: its “source” is “${String(source).slice(0, 60)}”, expected “${OUTLOOK_SOURCE}”.`);
  };
  for await (const ev of streamExport(file, { info })) {
    if (ev.type === "field") {
      if (ev.key === "source") source = typeof ev.value === "string" ? ev.value : String(ev.value);
      if (ev.key === "exportedAt") exportedAt = typeof ev.value === "string" ? ev.value : null;
      continue;
    }
    if (ev.type === "end") {
      if (source === null) throw new OutlookFileError(`The file has no “source” field. Expected “source”: “${OUTLOOK_SOURCE}” as written by the Outlook exporter.`);
      check();
      if (!ev.sawEmails) throw new OutlookFileError("The file has no “emails” list.");
      yield { type: "meta", source, exportedAt };
      continue;
    }
    check();
    let value: unknown;
    let repaired = false;
    try {
      const r = parseElement(ev.text);
      value = r.value; repaired = r.repaired;
    } catch (e) {
      yield { type: "invalid", invalid: { index: ev.index, entryId: null, subject: null, reason: `Not valid JSON (${(e as Error).message.slice(0, 80)}).` } };
      continue;
    }
    const v = validateMessage(value, ev.index);
    if (!v.ok) { yield { type: "invalid", invalid: v.invalid }; continue; }
    const prepared = prepareMessage(v.message, order);
    if ("error" in prepared) {
      yield { type: "invalid", invalid: { index: ev.index, entryId: v.message.entryId, subject: v.message.subject.slice(0, 120), reason: prepared.error } };
      continue;
    }
    yield { type: "valid", index: ev.index, item: prepared.item, repaired, evidence: prepared.evidence, ambiguous: prepared.ambiguous };
    if (++n % 100 === 0) { hooks.onBytes?.(info.bytesRead, info.totalBytes); await yieldToUi(); }
  }
  hooks.onBytes?.(info.bytesRead, info.totalBytes);
}

const MAX_INVALID_LISTED = 500;

/** Pass 1: validates and analyses the whole file WITHOUT storing anything, so the user can confirm what will be imported. */
export async function previewOutlookExport(file: ExportSource, filename: string, onProgress?: ProgressFn): Promise<OutlookPreview> {
  const settings = await getSettings();
  const db = await getDb();
  const employees = db.employees.all();

  let order: Order = settings.dateOrder;
  for (let attempt = 0; attempt < 2; attempt++) {
    const info: StreamInfo = { encoding: "utf-8", replacementChars: 0, bytesRead: 0, totalBytes: null };
    const dbIndex = await DuplicateIndex.fromDb();
    const senders = new Set<string>();
    const conversations = new Set<string>();
    const employeesSeen = new Set<string>();
    const otherSenderSet = new Set<string>();
    const months = new Map<string, { year: number; month: number; count: number }>();
    const invalidList: InvalidMessage[] = [];
    let total = 0, valid = 0, invalid = 0, employeeMessages = 0, otherSenderMessages = 0, nmcMessages = 0;
    let dupDb = 0, dupFile = 0, quoted = 0, signature = 0, htmlOnly = 0, repaired = 0, ambiguous = 0;
    let dateFrom: number | null = null, dateTo: number | null = null;
    let dmy = 0, mdy = 0;
    let meta: { source: string | null; exportedAt: string | null } = { source: null, exportedAt: null };
    const fileIndex = new DuplicateIndex();
    const warnings: string[] = [];

    for await (const ev of scan(file, order, info, { onBytes: (r, t) => onProgress?.({ phase: "validating", done: r, total: t ?? r }) })) {
      if (ev.type === "meta") { meta = ev; continue; }
      total++;
      if (ev.type === "invalid") {
        invalid++;
        if (invalidList.length < MAX_INVALID_LISTED) invalidList.push(ev.invalid);
        continue;
      }
      valid++;
      const p = ev.item.parsed;
      if (ev.repaired) repaired++;
      if (ev.ambiguous) ambiguous++;
      if (ev.evidence === "DMY") dmy++; else if (ev.evidence === "MDY") mdy++;
      senders.add(p.senderEmail || p.senderName.toLowerCase());
      conversations.add(ev.item.external?.conversationId ?? `s:${p.subject.toLowerCase()}`);
      const t = p.sentAt!.getTime();
      dateFrom = dateFrom == null ? t : Math.min(dateFrom, t);
      dateTo = dateTo == null ? t : Math.max(dateTo, t);
      const mk = `${p.sentAt!.getUTCFullYear()}-${p.sentAt!.getUTCMonth() + 1}`;
      const cur = months.get(mk) ?? { year: p.sentAt!.getUTCFullYear(), month: p.sentAt!.getUTCMonth() + 1, count: 0 };
      cur.count++; months.set(mk, cur);
      const n = ev.item.normalization;
      if (n?.quotedChars) quoted++;
      if (n?.signatureChars) signature++;
      if (n?.source === "html") htmlOnly++;

      if (isNmcAddress(p.senderEmail, settings.nmcAddresses)) nmcMessages++;
      else {
        const m = matchEmployee({ email: p.senderEmail, name: p.senderName }, employees, { allowNameFallback: false });
        if (m.employee) { employeeMessages++; employeesSeen.add(m.employee.id); }
        else { otherSenderMessages++; otherSenderSet.add(p.senderEmail || p.senderName.toLowerCase()); }
      }
      const k = dbIndex.keys(ev.item);
      if (dbIndex.check(k)) dupDb++; // already stored (earlier import or paste)
      else if (fileIndex.check(k)) dupFile++; // repeated inside this file
      else fileIndex.add(k);
    }

    const proven = (dmy > 0) !== (mdy > 0) ? (dmy > 0 ? "DMY" : "MDY") : null;
    if (proven && proven !== order && attempt === 0) { order = proven; continue; } // dates were read the wrong way round: scan again
    if (dmy && mdy) warnings.push(`Dates in this file mix day/month and month/day formats (${dmy} vs ${mdy} unambiguous dates). Using “${order}” — check the Review queue for date warnings.`);
    else if (proven && proven !== settings.dateOrder) warnings.push(`Dates in this file are clearly ${proven === "DMY" ? "day/month/year" : "month/day/year"}; that order was used instead of the Settings value (${settings.dateOrder}) and will be saved to Settings.`);
    if (ambiguous && !proven && !settings.dateOrderLearned) warnings.push(`${ambiguous} receivedAt value(s) have an ambiguous day/month order and were read as “${order === "DMY" ? "day/month" : "month/day"}”.`);
    if (info.replacementChars > 0) warnings.push(`${info.replacementChars} character(s) could not be decoded — the file is probably not UTF-8 (Arabic text may be damaged). Re-export it as UTF-8.`);
    if (repaired) warnings.push(`${repaired} message(s) contained characters that are not valid in JSON (raw line breaks or backslashes) and were repaired while reading. Their text is unchanged.`);
    if (invalid) warnings.push(`${invalid} message(s) cannot be imported and will be skipped (see the list). Nothing is silently discarded.`);
    return {
      filename, sizeBytes: info.totalBytes, encoding: info.encoding, exportedAt: meta.exportedAt, source: meta.source ?? OUTLOOK_SOURCE,
      total, valid, invalid, invalidList, invalidTruncated: invalid > invalidList.length,
      dateFrom: dateFrom == null ? null : new Date(dateFrom), dateTo: dateTo == null ? null : new Date(dateTo),
      uniqueSenders: senders.size, uniqueConversations: conversations.size,
      employeeMessages, matchedEmployees: employeesSeen.size, otherSenderMessages, otherSenders: otherSenderSet.size, nmcMessages,
      duplicatesInDb: dupDb, duplicatesInFile: dupFile,
      months: [...months.values()].sort((a, b) => a.year - b.year || a.month - b.month),
      withQuotedHistory: quoted, withSignature: signature, htmlOnly, repairedMessages: repaired,
      dateOrder: order, dateOrderProven: !!proven, ambiguousDates: ambiguous, warnings,
    };
  }
  throw new OutlookFileError("The dates in the file could not be interpreted consistently.");
}

export interface OutlookImportOptions { year: number; month: number; monthMode: MonthMode; onProgress?: ProgressFn }

/** Pass 2: reads the file again and imports the valid messages through the shared core and the existing analysis pipeline. */
export async function importOutlookExport(file: ExportSource, filename: string, preview: OutlookPreview, opts: OutlookImportOptions): Promise<ImportSummary> {
  if (!Number.isInteger(opts.year) || !Number.isInteger(opts.month) || opts.month < 1 || opts.month > 12) throw new ImportError("Select a valid year and month.");
  if (!preview.valid) throw new ImportError("There are no valid messages to import.");
  const warnings = [...preview.warnings];
  if (preview.dateOrderProven) {
    const s = await getSettings();
    if (s.dateOrder !== preview.dateOrder || !s.dateOrderLearned) await saveSettings({ dateOrder: preview.dateOrder, dateOrderLearned: true });
  }
  if (opts.monthMode === "selected") {
    const outside = preview.months.filter((m) => m.year !== opts.year || m.month !== opts.month).reduce((a, m) => a + m.count, 0);
    if (outside) warnings.push(`${outside} message(s) were received outside ${MONTH_NAMES[opts.month - 1]} ${opts.year}. They are stored and listed in Review (“date outside selected month”) until you include or exclude them.`);
  }
  const info: StreamInfo = { encoding: preview.encoding, replacementChars: 0, bytesRead: 0, totalBytes: null };
  async function* items(): AsyncGenerator<ImportItem> {
    for await (const ev of scan(file, preview.dateOrder, info)) if (ev.type === "valid") yield ev.item;
  }
  return runImport(items(), {
    source: "Outlook Desktop", year: opts.year, month: opts.month, monthMode: opts.monthMode, filename,
    exportedAt: preview.exportedAt && !Number.isNaN(Date.parse(preview.exportedAt)) ? new Date(preview.exportedAt) : null,
    warnings, total: preview.valid, onProgress: opts.onProgress,
  });
}
