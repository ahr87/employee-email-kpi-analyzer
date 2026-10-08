import type ExcelJSNS from "exceljs";

export type ExcelJSModule = typeof ExcelJSNS;

/**
 * ExcelJS is loaded on demand (only when exporting/importing a workbook) so it does not weigh down the first load.
 * The pre-built browser bundle is used; it also runs under Node (tests).
 */
export async function loadExcelJS(): Promise<ExcelJSModule> {
  const mod = (await import("exceljs/dist/exceljs.min.js")) as unknown as { default?: ExcelJSModule } & ExcelJSModule;
  return (mod.default ?? mod) as ExcelJSModule;
}
