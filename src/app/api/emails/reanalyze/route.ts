import { z } from "zod";
import { handle } from "@/lib/api";
import { analyzeMonth } from "@/lib/import/analyze";
const body = z.object({ year: z.number().int(), month: z.number().int().min(1).max(12), ids: z.array(z.string()).optional(), resetManual: z.boolean().optional() });
export const POST = (req: Request) =>
  handle(req, async () => {
    const b = body.parse(await req.json());
    return analyzeMonth(b.year, b.month, { emailIds: b.ids, resetManual: b.resetManual, audit: true });
  });
