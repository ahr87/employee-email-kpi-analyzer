import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ImportError } from "./import/importer";

/** Wraps a route handler so every failure becomes a clear JSON error (never a silent failure). */
export async function handle(fn: () => Promise<Response | unknown>): Promise<Response> {
  try {
    const r = await fn();
    return r instanceof Response ? r : NextResponse.json(r);
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
    }
    if (e instanceof ImportError) return NextResponse.json({ error: e.message }, { status: 400 });
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: string }).code;
    if (code === "P2002") return NextResponse.json({ error: "A record with the same unique value (email or employee ID) already exists." }, { status: 409 });
    if (code === "P2025") return NextResponse.json({ error: "Record not found." }, { status: 404 });
    console.error("[api]", e);
    return NextResponse.json({ error: `Database or server error: ${msg.split("\n").filter(Boolean).pop()}` }, { status: 500 });
  }
}

export function ym(req: Request) {
  const u = new URL(req.url).searchParams;
  const year = Number(u.get("year"));
  const month = Number(u.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new ImportError("year and month are required.");
  return { year, month, params: u };
}

export const download = (body: BodyInit, filename: string, type: string) =>
  new Response(body, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
