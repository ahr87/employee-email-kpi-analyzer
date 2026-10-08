import { getDb, newId } from "../db";

export type AuditAction =
  | "CLASSIFICATION_CHANGED" | "CLASSIFICATION_APPROVED" | "EMPLOYEE_ASSIGNED" | "MONTH_DECISION"
  | "EMPLOYEE_CREATED" | "EMPLOYEE_UPDATED" | "EMPLOYEE_DELETED" | "EMPLOYEES_IMPORTED"
  | "SETTINGS_CHANGED" | "BATCH_IMPORTED" | "BATCH_DELETED" | "DATASET_DELETED" | "REANALYZED"
  | "DATA_RESET" | "DEMO_LOADED" | "BACKUP_EXPORTED" | "BACKUP_RESTORED";

export async function logAudit(action: AuditAction, entityType: string, entityId: string, summary: string, details: unknown = {}) {
  const db = await getDb();
  await db.apply([{ table: "audit", put: [{ id: newId(), createdAt: new Date(), action, entityType, entityId, summary, details: JSON.stringify(details) }] }]);
}

export async function listAudit(opts: { limit?: number; entityType?: string; entityId?: string } = {}) {
  const db = await getDb();
  return db.audit.all()
    .filter((a) => (!opts.entityType || a.entityType === opts.entityType) && (!opts.entityId || a.entityId === opts.entityId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, Math.min(opts.limit ?? 100, 1000));
}
