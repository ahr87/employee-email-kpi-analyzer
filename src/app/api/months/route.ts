import { handle } from "@/lib/api";
import { monthsWithData } from "@/lib/reports/aggregate";
export const GET = () => handle(async () => ({ months: await monthsWithData() }));
