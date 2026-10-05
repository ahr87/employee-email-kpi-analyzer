import { z } from "zod";
import { handle } from "@/lib/api";
import { prisma } from "@/lib/database/client";
import { logAudit } from "@/lib/audit";
const body = z.object({ year: z.number().int(), month: z.number().int().min(1).max(12), confirm: z.literal("DELETE") });
/** Deletes the whole dataset (all batches and emails) of one month. */
export const DELETE = (req: Request) =>
  handle(req, async () => {
    const { year, month } = body.parse(await req.json());
    const n = await prisma.email.count({ where: { year, month } });
    await prisma.email.deleteMany({ where: { year, month } });
    await prisma.batch.deleteMany({ where: { year, month } });
    await logAudit("DATASET_DELETED", "Month", `${year}-${month}`, `Dataset ${year}-${String(month).padStart(2, "0")} deleted (${n} emails)`, { year, month, emails: n });
    return { deleted: n };
  });
