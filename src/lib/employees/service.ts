import { z } from "zod";
import { prisma } from "../database/client";
import { logAudit } from "../audit";

export const employeeInput = z.object({
  employeeId: z.string().trim().min(1, "Employee ID is required").max(50),
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Invalid email address").max(200),
  department: z.string().trim().max(120).default(""),
  team: z.string().trim().max(120).default(""),
  active: z.boolean().default(true),
});
export type EmployeeInput = z.infer<typeof employeeInput>;

export async function listEmployees(q?: string) {
  const where = q
    ? { OR: ["name", "email", "employeeId", "department", "team"].map((f) => ({ [f]: { contains: q } })) }
    : {};
  return prisma.employee.findMany({ where, orderBy: { name: "asc" } });
}

export async function createEmployee(raw: unknown) {
  const data = employeeInput.parse(raw);
  const emp = await prisma.employee.create({ data });
  await logAudit("EMPLOYEE_CREATED", "Employee", emp.id, `Employee ${emp.name} created`, data);
  return emp;
}

export async function updateEmployee(id: string, raw: unknown) {
  const before = await prisma.employee.findUniqueOrThrow({ where: { id } });
  const data = employeeInput.partial().parse(raw);
  const emp = await prisma.employee.update({ where: { id }, data });
  await logAudit("EMPLOYEE_UPDATED", "Employee", id, `Employee ${emp.name} updated`, { before, after: data });
  return emp;
}

export async function deleteEmployee(id: string) {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id } });
  await prisma.employee.delete({ where: { id } }); // emails keep existing, employeeId set to null (unmatched)
  await logAudit("EMPLOYEE_DELETED", "Employee", id, `Employee ${emp.name} deleted`, emp);
}
