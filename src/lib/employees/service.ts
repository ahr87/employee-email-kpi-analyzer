import { z } from "zod";
import { getDb, newId } from "../db";
import { logAudit } from "../audit";
import type { EmployeeRec } from "../storage/types";

export const employeeInput = z.object({
  employeeId: z.string().trim().min(1, "Employee ID is required").max(50),
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Invalid email address").max(200),
  department: z.string().trim().max(120).default(""),
  team: z.string().trim().max(120).default(""),
  active: z.boolean().default(true),
});
export type EmployeeInput = z.infer<typeof employeeInput>;

export class DuplicateEmployeeError extends Error {}

async function assertUnique(data: Partial<EmployeeInput>, selfId?: string) {
  const db = await getDb();
  for (const e of db.employees.all()) {
    if (e.id === selfId) continue;
    if (data.email && e.email === data.email) throw new DuplicateEmployeeError(`An employee with the email ${data.email} already exists (${e.name}).`);
    if (data.employeeId && e.employeeId === data.employeeId) throw new DuplicateEmployeeError(`Employee ID ${data.employeeId} is already used by ${e.name}.`);
  }
}

export async function listEmployees(q?: string): Promise<EmployeeRec[]> {
  const db = await getDb();
  const needle = q?.trim().toLowerCase();
  return db.employees.all()
    .filter((e) => !needle || [e.name, e.email, e.employeeId, e.department, e.team].some((f) => f.toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getEmployee(id: string) {
  return (await getDb()).employees.get(id) ?? null;
}

export async function createEmployee(raw: unknown) {
  const data = employeeInput.parse(raw);
  await assertUnique(data);
  const now = new Date();
  const emp: EmployeeRec = { id: newId(), ...data, createdAt: now, updatedAt: now };
  await (await getDb()).apply([{ table: "employees", put: [emp] }]);
  await logAudit("EMPLOYEE_CREATED", "Employee", emp.id, `Employee ${emp.name} created`, data);
  return emp;
}

export async function updateEmployee(id: string, raw: unknown) {
  const db = await getDb();
  const before = db.employees.get(id);
  if (!before) throw new Error("Employee not found.");
  const data = employeeInput.partial().parse(raw);
  await assertUnique(data, id);
  const emp: EmployeeRec = { ...before, ...data, updatedAt: new Date() };
  await db.apply([{ table: "employees", put: [emp] }]);
  await logAudit("EMPLOYEE_UPDATED", "Employee", id, `Employee ${emp.name} updated`, { before, after: data });
  return emp;
}

/** Emails of a deleted employee are kept and become "unmatched" (as before). */
export async function deleteEmployee(id: string) {
  const db = await getDb();
  const emp = db.employees.get(id);
  if (!emp) throw new Error("Employee not found.");
  const orphaned = db.emails.all().filter((e) => e.employeeId === id).map((e) => ({ ...e, employeeId: null, employeeManual: false }));
  await db.apply([{ table: "employees", delete: [id] }, { table: "emails", put: orphaned }]);
  await logAudit("EMPLOYEE_DELETED", "Employee", id, `Employee ${emp.name} deleted`, emp);
}
