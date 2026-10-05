import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { applyEmailAction, getEmailDetail } from "@/lib/import/emails";
type Ctx = { params: Promise<{ id: string }> };
export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async () => (await getEmailDetail((await params).id)) ?? NextResponse.json({ error: "Email not found." }, { status: 404 }));
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(req, async () => applyEmailAction((await params).id, await req.json()));
