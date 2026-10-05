import { download, handle, ym } from "@/lib/api";
import { monthlyStats } from "@/lib/reports/aggregate";
import { monthlyCsv, monthlyXlsx } from "@/lib/reports/excel";
import { MONTH_NAMES } from "@/lib/types";
export const GET = (req: Request) =>
  handle(req, async () => {
    const { year, month, params } = ym(req);
    const format = params.get("format") ?? "json";
    const name = `email-kpi-${year}-${String(month).padStart(2, "0")}-${MONTH_NAMES[month - 1].toLowerCase()}`;
    if (format === "csv") return download(await monthlyCsv(year, month), `${name}.csv`, "text/csv; charset=utf-8");
    if (format === "xlsx") return download(new Uint8Array(await monthlyXlsx(year, month)), `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return monthlyStats(year, month);
  });
