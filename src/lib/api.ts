import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ImportError } from "./import/importer";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

/**
 * The app has no login and holds sensitive emails, so it only serves requests that really come from the local
 * browser UI: the Host header must be a local name (or listed in ALLOWED_HOSTS) — this stops DNS-rebinding — and
 * state-changing requests must not come from another origin (a web page elsewhere cannot trigger resets/deletes).
 */
export function guard(req: Request): Response | null {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.replace(/:\d+$/, "");
  const extra = (process.env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!LOCAL_HOSTS.includes(hostname) && !extra.includes(hostname)) {
    return NextResponse.json({ error: `Host “${hostname}” is not allowed. Open the app at http://localhost:3000 (or add the name to ALLOWED_HOSTS).` }, { status: 403 });
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    let sameOrigin = true;
    if (origin) { try { sameOrigin = new URL(origin).host.toLowerCase() === host; } catch { sameOrigin = false; } }
    if (!sameOrigin || req.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
    }
  }
  return null;
}

/** Wraps a route handler so every failure becomes a clear JSON error (never a silent failure). */
export async function handle(req: Request, fn: () => Promise<Response | unknown>): Promise<Response> {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const r = await fn();
    return r instanceof Response ? r : NextResponse.json(r);
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
    }
    if (e instanceof SyntaxError) return NextResponse.json({ error: "The request body is not valid JSON." }, { status: 400 });
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
