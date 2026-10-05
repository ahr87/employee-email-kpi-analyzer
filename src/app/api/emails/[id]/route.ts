import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { applyEmailAction, getEmailDetail } from "@/lib/import/emails";
type Ctx = { params: Promise<{ id: string }> };
export const GET = (_: Request, { params }: Ctx) =>
  handle(async () => (await getEmailDetail((await params).id)) ?? NextResponse.json({ error: "Email not found." }, { status: 404 }));
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async () => applyEmailAction((await params).id, await req.json()));
