import { handle } from "@/lib/api";
import { trend } from "@/lib/reports/aggregate";
export const GET = (req: Request) =>
  handle(async () => {
    const u = new URL(req.url).searchParams;
    const year = Number(u.get("year")) || new Date().getFullYear();
    return { year, months: await trend(year, u.get("employeeId") || undefined) };
  });
