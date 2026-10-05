import { handle } from "@/lib/api";
import { listEmails } from "@/lib/import/emails";
export const GET = (req: Request) => handle(async () => listEmails(Object.fromEntries(new URL(req.url).searchParams)));
