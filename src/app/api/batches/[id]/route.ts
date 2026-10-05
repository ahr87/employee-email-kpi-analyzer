import { handle } from "@/lib/api";
import { deleteBatch } from "@/lib/import/importer";
export const DELETE = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => { await deleteBatch((await params).id); return { ok: true }; });
