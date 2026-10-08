/**
 * Persistent record shapes (what is stored in the browser). They mirror the former SQLite model; dates are real
 * `Date` objects in memory/IndexedDB and ISO strings only inside backup files.
 */
export interface EmployeeRec {
  id: string;
  employeeId: string;
  name: string;
  email: string; // lower-case; primary matching key
  department: string;
  team: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BatchRec {
  id: string;
  number: number;
  year: number;
  month: number; // 1-12
  createdAt: Date;
  totalParsed: number;
  newEmails: number;
  exactDuplicates: number;
  matched: number;
  unmatched: number;
  autoClassified: number;
  needsReview: number;
  warnings: string; // JSON array of strings
  status: string; // IMPORTING | COMPLETED | ANALYSIS_FAILED
  source: string; // "Paste" | "Outlook Desktop"
  filename: string | null; // Outlook export file name
  exportedAt: Date | null; // when the Outlook exporter wrote the file
  dateFrom: Date | null; // first / last message time in the batch
  dateTo: Date | null;
  uniqueSenders: number;
  uniqueConversations: number;
}

export interface EmailRec {
  id: string;
  batchId: string;
  year: number; // analysis month the email was imported into
  month: number;
  role: string; // EMPLOYEE | NMC
  senderName: string;
  senderEmail: string;
  toRecipients: string;
  ccRecipients: string;
  subject: string;
  sentAt: Date | null; // naive wall-clock time stored as UTC
  sentAtAlt: Date | null;
  body: string;
  rawSource: string; // exact pasted text
  messageId: string | null;
  contentHash: string;
  looseHash: string;
  conversationKey: string;
  isForward: boolean;
  isReply: boolean;
  uncertainFields: string; // JSON array
  incidentIds: string;
  serviceIds: string;
  circuitIds: string;
  locations: string;
  ipAddresses: string;
  devices: string;
  quoted: boolean;
  /** Outlook import: EntryID of the message (strongest exact-duplicate key) and Outlook's ConversationID. */
  externalMessageId: string | null;
  externalConversationId: string | null;
  /** Outlook import: hash of conversationId + minute + sender + subject (second duplicate tier); "" for pasted emails. */
  extKey: string;
  /** JSON: how the analysis copy was derived (plain/html, quoted history and signature sizes). "{}" for pasted emails. */
  normalization: string;
  kind: string; // REPORT | FOLLOW_UP | NMC | EXTERNAL
  counted: boolean;
  outsideMonth: boolean;
  monthDecision: string; // IN_MONTH | INCLUDED | EXCLUDED | REVIEW
  employeeId: string | null;
  employeeManual: boolean;
  autoClass: string;
  confidence: number;
  reason: string;
  finalClass: string;
  isManual: boolean;
  overrideReason: string | null;
  overrideAt: Date | null;
  duplicateOfId: string | null;
  duplicateSimilarity: number | null;
  duplicateReason: string | null;
  possibleDuplicateOfId: string | null;
  possibleDuplicateSim: number | null;
  reviewStatus: string; // OK | NEEDS_REVIEW | REVIEWED
  reviewReasons: string; // JSON array
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditRec {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  details: string; // JSON
}

export interface SettingRec {
  id: string; // key
  value: unknown;
}

/** The original Outlook message, exactly as exported (known fields only). Loaded on demand, never held in memory. */
export interface RawRec {
  id: string; // = the email's id
  batchId: string;
  entryId: string;
  conversationId: string | null;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  cc: string;
  receivedAt: string; // as written in the file
  body: string; // original plain-text body, including quoted history and signature
  htmlGz: Uint8Array | null; // original HTML body, gzip-compressed
  html: string | null; // original HTML body when compression is unavailable
  htmlChars: number;
}

export interface TableMap {
  employees: EmployeeRec;
  batches: BatchRec;
  emails: EmailRec;
  audit: AuditRec;
  settings: SettingRec;
  raw: RawRec;
}
export type TableName = keyof TableMap;
export const TABLES: TableName[] = ["employees", "batches", "emails", "audit", "settings", "raw"];
/** Tables held in memory. `raw` (original Outlook messages) is read on demand. */
export const PRELOADED: TableName[] = ["employees", "batches", "emails", "audit", "settings"];
