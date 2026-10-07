import Papa from "papaparse";
import ExcelJS from "exceljs";
import { HttpError } from "./supabase";
export async function parseImport(file: File, chosen = "") {
  if (file.size > 50 * 1024 * 1024)
    throw new HttpError(413, "Maximum file size: 50 MB");
  let rows: Record<string, string>[] = [];
  let headers: string[] = [];
  let sheets: string[] = [];
  let sheet = "";
  if (file.name.toLowerCase().endsWith(".csv")) {
    const result = Papa.parse<Record<string, string>>(await file.text(), {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
    });
    if (
      result.errors.some(
        (e) =>
          e.code === "MissingQuotes" ||
          e.code === "InvalidQuotes" ||
          e.code === "TooManyFields",
      )
    )
      throw new HttpError(400, "Invalid CSV structure");
    headers = result.meta.fields || [];
    rows = result.data;
  } else if (file.name.toLowerCase().endsWith(".xlsx")) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await file.arrayBuffer());
    sheets = book.worksheets.map((w) => w.name);
    const selected = chosen ? book.getWorksheet(chosen) : book.worksheets[0];
    if (!selected) throw new HttpError(400, "Worksheet not found");
    sheet = selected.name;
    const header = selected.getRow(1);
    if (header.cellCount > 200) throw new HttpError(400, "Maximum 200 columns");
    headers = Array.from(
      { length: header.cellCount },
      (_, i) => header.getCell(i + 1).text.trim() || `Column ${i + 1}`,
    );
    if (selected.rowCount > 50001)
      throw new HttpError(400, "Maximum 50,000 rows");
    selected.eachRow((row, index) => {
      if (index > 1)
        rows.push(
          Object.fromEntries(
            headers.map((h, i) => [h, row.getCell(i + 1).text]),
          ),
        );
    });
  } else throw new HttpError(400, "Use CSV or XLSX");
  if (
    !headers.length ||
    headers.length > 200 ||
    rows.length > 50000 ||
    headers.length !== new Set(headers).size
  )
    throw new HttpError(400, "Invalid headers or maximum rows exceeded");
  return { headers, rows, sheets, sheet, total: rows.length };
}
