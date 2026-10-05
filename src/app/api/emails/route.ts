import { handle } from "@/lib/api";
import { listEmails } from "@/lib/import/emails";
export const GET = (req: Request) => handle(req, async () => listEmails(Object.fromEntries(new URL(req.url).searchParams)));
