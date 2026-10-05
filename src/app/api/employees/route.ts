import { handle } from "@/lib/api";
import { createEmployee, listEmployees } from "@/lib/employees/service";
export const GET = (req: Request) =>
  handle(async () => ({ employees: await listEmployees(new URL(req.url).searchParams.get("q") ?? undefined) }));
export const POST = (req: Request) => handle(async () => createEmployee(await req.json()));
