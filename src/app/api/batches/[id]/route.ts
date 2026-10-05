import { handle } from "@/lib/api";
import { deleteBatch } from "@/lib/import/importer";
export const DELETE = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(req, async () => { await deleteBatch((await params).id); return { ok: true }; });
