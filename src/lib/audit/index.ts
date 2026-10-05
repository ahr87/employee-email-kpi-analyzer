import { prisma } from "../database/client";

export type AuditAction =
  | "CLASSIFICATION_CHANGED" | "CLASSIFICATION_APPROVED" | "EMPLOYEE_ASSIGNED" | "MONTH_DECISION"
  | "EMPLOYEE_CREATED" | "EMPLOYEE_UPDATED" | "EMPLOYEE_DELETED" | "EMPLOYEES_IMPORTED"
  | "SETTINGS_CHANGED" | "BATCH_IMPORTED" | "BATCH_DELETED" | "DATASET_DELETED" | "REANALYZED"
  | "DATA_RESET" | "DEMO_LOADED";

export async function logAudit(action: AuditAction, entityType: string, entityId: string, summary: string, details: unknown = {}) {
  await prisma.auditLog.create({
    data: { action, entityType, entityId, summary, details: JSON.stringify(details) },
  });
}
