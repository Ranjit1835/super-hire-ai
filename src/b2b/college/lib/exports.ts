// Files built in the browser from table data (no server file storage): CSV (Excel-safe) and XLSX (exceljs,
// loaded on demand; values written as plain values, never formulas).
import { toCsv } from "@/features/b2b/lib/csv-export";

export type Cell = string | number | null;

export function tableToCsv(columns: readonly string[], rows: Cell[][]): string {
  return toCsv([...columns], rows);
}

export async function tableToXlsx(sheetName: string, columns: readonly string[], rows: Cell[][]): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "HiResume";
  const ws = wb.addWorksheet(sheetName.slice(0, 31) || "Sheet1");
  ws.addRow([...columns]).font = { bold: true };
  for (const r of rows) {
    // A text cell starting with "=" is still text in exceljs (no formula object), so it can't execute.
    ws.addRow(r.map((v) => (v === null ? "" : v)));
  }
  ws.columns.forEach((c, i) => { c.width = Math.min(40, Math.max(10, columns[i]?.length ?? 10) + 4); });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export function download(filename: string, data: BlobPart, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsvFile(filename: string, columns: readonly string[], rows: Cell[][]) {
  // UTF-8 BOM so Excel shows Telugu / Hindi names correctly.
  download(filename, String.fromCharCode(0xfeff) + tableToCsv(columns, rows), "text/csv;charset=utf-8");
}

export async function downloadXlsxFile(filename: string, sheet: string, columns: readonly string[], rows: Cell[][]) {
  download(filename, await tableToXlsx(sheet, columns, rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

export const fileStamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
