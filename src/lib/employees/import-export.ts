import ExcelJS from "exceljs";
import { prisma } from "../database/client";
import { logAudit } from "../audit";
import { employeeInput } from "./service";
import { toCsv, parseCsv } from "../reports/csv";

const ALIASES: Record<string, string[]> = {
  employeeId: ["employee id", "employeeid", "id", "emp id", "emp no", "employee no", "employee number"],
  name: ["employee name", "name", "full name"],
  email: ["email", "email address", "e-mail", "mail"],
  department: ["department", "dept"],
  team: ["team", "section"],
  active: ["active", "status", "is active"],
};

function mapHeader(h: string): string | null {
  const n = h.trim().toLowerCase();
  for (const [k, list] of Object.entries(ALIASES)) if (list.includes(n)) return k;
  return null;
}

function toBool(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return !["false", "0", "no", "inactive", "n", "disabled"].includes(s);
}

export interface EmployeeImportResult { created: number; updated: number; errors: string[] }

export async function readRows(filename: string, data: Buffer): Promise<string[][]> {
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => {
        if (v && typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text);
        if (v && typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result);
        return v == null ? "" : String(v);
      });
      rows.push(vals);
    });
    return rows;
  }
  return parseCsv(data.toString("utf8"));
}

export async function importEmployees(filename: string, data: Buffer): Promise<EmployeeImportResult> {
  const rows = await readRows(filename, data);
  const result: EmployeeImportResult = { created: 0, updated: 0, errors: [] };
  if (rows.length < 2) { result.errors.push("The file has no data rows."); return result; }
  const cols = rows[0].map(mapHeader);
  if (!cols.includes("email") || !cols.includes("name")) {
    result.errors.push("Header row must contain at least Name and Email columns (Employee ID, Department, Team, Active are optional).");
    return result;
  }
  for (let i = 1; i < rows.length; i++) {
    const rec: Record<string, unknown> = {};
    cols.forEach((c, idx) => { if (c) rec[c] = rows[i][idx] ?? ""; });
    if (!String(rec.email ?? "").trim() && !String(rec.name ?? "").trim()) continue;
    const parsed = employeeInput.safeParse({
      employeeId: String(rec.employeeId ?? "").trim() || `E${String(i).padStart(4, "0")}`,
      name: rec.name, email: rec.email, department: rec.department ?? "", team: rec.team ?? "",
      active: "active" in rec ? toBool(rec.active) : true,
    });
    if (!parsed.success) { result.errors.push(`Row ${i + 1}: ${parsed.error.issues.map((x) => x.message).join(", ")}`); continue; }
    const d = parsed.data;
    try {
      const existing = await prisma.employee.findUnique({ where: { email: d.email } });
      if (existing) { await prisma.employee.update({ where: { id: existing.id }, data: d }); result.updated++; }
      else { await prisma.employee.create({ data: d }); result.created++; }
    } catch (e) {
      result.errors.push(`Row ${i + 1}: ${(e as Error).message.split("\n").pop()}`);
    }
  }
  await logAudit("EMPLOYEES_IMPORTED", "Employee", "", `Imported employees from ${filename}: ${result.created} created, ${result.updated} updated`, result);
  return result;
}

const HEADERS = ["Employee ID", "Employee Name", "Email Address", "Department", "Team", "Active", "Created At", "Updated At"];

export async function employeeRows() {
  const emps = await prisma.employee.findMany({ orderBy: { name: "asc" } });
  return emps.map((e) => [e.employeeId, e.name, e.email, e.department, e.team, e.active ? "Yes" : "No", e.createdAt.toISOString(), e.updatedAt.toISOString()]);
}

export async function exportEmployeesCsv(): Promise<string> {
  return toCsv([HEADERS, ...(await employeeRows())]);
}

export async function exportEmployeesXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Employees");
  ws.addRow(HEADERS).font = { bold: true };
  for (const r of await employeeRows()) ws.addRow(r);
  ws.columns.forEach((c) => (c.width = 24));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
