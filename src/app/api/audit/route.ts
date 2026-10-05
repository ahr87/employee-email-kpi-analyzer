import { handle } from "@/lib/api";
import { prisma } from "@/lib/database/client";
export const GET = (req: Request) =>
  handle(async () => {
    const u = new URL(req.url).searchParams;
    const take = Math.min(Number(u.get("limit")) || 100, 500);
    return { logs: await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take }) };
  });
