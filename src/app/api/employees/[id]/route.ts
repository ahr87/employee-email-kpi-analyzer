import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { prisma } from "@/lib/database/client";
import { deleteEmployee, updateEmployee } from "@/lib/employees/service";
type Ctx = { params: Promise<{ id: string }> };
export const GET = (_: Request, { params }: Ctx) =>
  handle(async () => (await prisma.employee.findUnique({ where: { id: (await params).id } })) ?? NextResponse.json({ error: "Employee not found." }, { status: 404 }));
export const PATCH = (req: Request, { params }: Ctx) => handle(async () => updateEmployee((await params).id, await req.json()));
export const DELETE = (_: Request, { params }: Ctx) => handle(async () => { await deleteEmployee((await params).id); return { ok: true }; });
