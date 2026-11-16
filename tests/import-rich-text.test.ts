import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseImport } from "../src/lib/server/parse-import";
import { detectMapping, normalizeRow } from "../src/lib/imports";

const rich = (...text: string[]) => ({
  richText: text.map((value) => ({ text: value, font: { bold: true } })),
});
const link = (value: unknown) =>
  ({
    text: value,
    hyperlink: "https://example.invalid/display-only",
  }) as ExcelJS.CellHyperlinkValue;
async function file(book: ExcelJS.Workbook) {
  const bytes = await book.xlsx.writeBuffer();
  return new File([new Uint8Array(bytes)], "fixture.xlsx");
}

test("imports flatten rich display text inside hyperlinks before preview and normalization", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Leads");
  sheet.addRow(["Email", "Company", "Owner", "Phone", "Industry"]);
  sheet.addRow([
    link(rich("alex", "@example.test")),
    link(rich("Café ", "Horizonte & Hijos")),
    rich("Álex ", "Pérez"),
    "+1 555 0100",
    "Retail",
  ]);
  sheet.addRow([
    "second@example.test",
    link(rich("<script>", "literal text</script>")),
    "Sam",
    "",
    "",
  ]);
  sheet.addRow(["third@example.test", link(rich()), "", "", ""]);
  const parsed = await parseImport(await file(book));
  assert(
    parsed.rows.every((row) =>
      Object.values(row).every((v) => typeof v === "string"),
    ),
  );
  assert.equal(parsed.rows[0].Email, "alex@example.test");
  assert.equal(parsed.rows[0].Company, "Café Horizonte & Hijos");
  assert.equal(parsed.rows[0].Owner, "Álex Pérez");
  assert.equal(parsed.rows[2].Company, "");
  assert.deepEqual(
    normalizeRow(parsed.rows[0], detectMapping(parsed.headers)),
    {
      valid: true,
      email: "alex@example.test",
      company: "Café Horizonte & Hijos",
      contact: "Álex Pérez",
      phone: "+1 555 0100",
      industry: "Retail",
    },
  );
  const preview = renderToStaticMarkup(
    createElement(
      "table",
      null,
      createElement(
        "tbody",
        null,
        parsed.rows.map((row, i) =>
          createElement(
            "tr",
            { key: i },
            parsed.headers.map((header) =>
              createElement("td", { key: header }, row[header]),
            ),
          ),
        ),
      ),
    ),
  );
  assert(preview.includes("Café Horizonte &amp; Hijos"));
  assert(!preview.includes("[object Object]"));
  assert(!preview.includes("<script>"));
  assert(preview.includes("&lt;script&gt;literal text&lt;/script&gt;"));
});

test("imports flatten rich hyperlink headers and still reject duplicate display labels", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Leads");
  sheet.addRow([link(rich(" Em", "ail ")), link(rich("Com", "pany"))]);
  sheet.addRow(["alex@example.test", "Example"]);
  const parsed = await parseImport(await file(book));
  assert.deepEqual(parsed.headers, ["Email", "Company"]);
  assert.equal(detectMapping(parsed.headers).email, "Email");
  sheet.getCell("B1").value = link(rich("Em", "ail"));
  await assert.rejects(parseImport(await file(book)), /Invalid headers/);
});

test("imports preserve ordinary spreadsheet and CSV text without evaluating formulas or URLs", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Leads");
  sheet.addRow([
    "Email",
    "Company",
    "Number",
    "Boolean",
    "Formula",
    "Uncalculated",
  ]);
  sheet.addRow([
    "alex@example.test",
    { text: "Display name", hyperlink: "https://example.invalid/not-followed" },
    42,
    true,
    { formula: "1+2", result: 3 },
    { formula: 'WEBSERVICE("https://example.invalid/not-executed")' },
  ]);
  const parsed = await parseImport(await file(book));
  assert.deepEqual(parsed.rows[0], {
    Email: "alex@example.test",
    Company: "Display name",
    Number: "42",
    Boolean: "true",
    Formula: "3",
    Uncalculated: "",
  });
  const csv = await parseImport(
    new File(
      [
        'Email,Company\nalex@example.test,"=HYPERLINK(""https://example.invalid"",""Visible"")"',
      ],
      "fixture.csv",
    ),
  );
  assert.equal(
    csv.rows[0].Company,
    '=HYPERLINK("https://example.invalid","Visible")',
  );
});
