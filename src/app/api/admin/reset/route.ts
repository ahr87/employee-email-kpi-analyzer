import { z } from "zod";
import { handle } from "@/lib/api";
import { resetData } from "@/lib/demo";
const body = z.object({ confirm: z.literal("RESET"), employees: z.boolean().optional(), settings: z.boolean().optional() });
export const POST = (req: Request) =>
  handle(req, async () => { await resetData(body.parse(await req.json())); return { ok: true }; });
