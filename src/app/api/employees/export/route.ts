import { download, handle } from "@/lib/api";
import { exportEmployeesCsv, exportEmployeesXlsx } from "@/lib/employees/import-export";
export const GET = (req: Request) =>
  handle(req, async () => {
    if (new URL(req.url).searchParams.get("format") === "csv") return download(await exportEmployeesCsv(), "employees.csv", "text/csv; charset=utf-8");
    return download(new Uint8Array(await exportEmployeesXlsx()), "employees.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });
