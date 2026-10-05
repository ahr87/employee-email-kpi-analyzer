import { handle } from "@/lib/api";
import { z } from "zod";
import { importBatch } from "@/lib/import/importer";
const body = z.object({ year: z.number().int(), month: z.number().int().min(1).max(12), text: z.string() });
export const POST = (req: Request) => handle(async () => importBatch(body.parse(await req.json())));
