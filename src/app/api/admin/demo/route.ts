import { handle } from "@/lib/api";
import { loadDemoData } from "@/lib/demo";
export const POST = (req: Request) => handle(req, loadDemoData);
