import { MONTH_NAMES } from "../types";
import { downloadFile, CSV_MIME, XLSX_MIME } from "../utils/download";
import { monthlyCsv, monthlyXlsx } from "./excel";

export const reportBaseName = (year: number, month: number) => `email-kpi-${year}-${String(month).padStart(2, "0")}-${MONTH_NAMES[month - 1].toLowerCase()}`;

/** Builds the workbook in the browser and downloads it. */
export async function exportMonthlyXlsx(year: number, month: number) {
  downloadFile(`${reportBaseName(year, month)}.xlsx`, await monthlyXlsx(year, month), XLSX_MIME);
}
export async function exportMonthlyCsv(year: number, month: number) {
  downloadFile(`${reportBaseName(year, month)}.csv`, await monthlyCsv(year, month), CSV_MIME);
}
