import { handle, ym } from "@/lib/api";
import { monthlyStats } from "@/lib/reports/aggregate";
import { prisma } from "@/lib/database/client";
export const GET = (req: Request) =>
  handle(async () => {
    const { year, month } = ym(req);
    const [stats, batches] = await Promise.all([monthlyStats(year, month), prisma.batch.count({ where: { year, month } })]);
    return { ...stats, batches };
  });
