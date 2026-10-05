import { handle } from "@/lib/api";
import { monthsWithData } from "@/lib/reports/aggregate";
export const GET = (req: Request) => handle(req, async () => ({ months: await monthsWithData() }));
