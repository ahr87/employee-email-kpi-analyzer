import { handle } from "@/lib/api";
import { prisma } from "@/lib/database/client";
export const GET = (req: Request) =>
  handle(req, async () => {
    const u = new URL(req.url).searchParams;
    const year = Number(u.get("year")), month = Number(u.get("month"));
    const batches = await prisma.batch.findMany({
      where: { ...(year ? { year } : {}), ...(month ? { month } : {}) },
      orderBy: { number: "desc" },
    });
    return { batches: batches.map((b) => ({ ...b, warnings: JSON.parse(b.warnings) })) };
  });
