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
  status: string; // COMPLETED | ANALYSIS_FAILED
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
  kind: string; // REPORT | FOLLOW_UP | NMC
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

export interface TableMap {
  employees: EmployeeRec;
  batches: BatchRec;
  emails: EmailRec;
  audit: AuditRec;
  settings: SettingRec;
}
export type TableName = keyof TableMap;
export const TABLES: TableName[] = ["employees", "batches", "emails", "audit", "settings"];
