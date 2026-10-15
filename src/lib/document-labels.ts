import type { Document, Locale } from "./domain";

export function documentLabel(doc: Document, locale: Locale): string {
  if (doc.kind === "bank_statement") {
    const number =
      doc.statement_number ||
      Number(doc.name.match(/(?:statement|extracto)\s+(\d+)$/i)?.[1]) ||
      "";
    return `${locale === "es" ? "Extracto bancario" : "Bank Statement"}${number ? ` ${number}` : ""}`;
  }
  return doc.kind === "application"
    ? locale === "es"
      ? "Aplicación firmada"
      : "Signed application"
    : doc.name;
}

export function documentProgress(documents: Document[]) {
  const application = documents.some(
    (d) => d.kind === "application" && d.status === "approved",
  );
  const banks = documents.filter(
    (d) => d.kind === "bank_statement" && d.status === "approved",
  );
  const statements = new Set(banks.map((d) => d.content_hash || d.id)).size;
  const extra = documents.filter(
    (d) =>
      !["application", "bank_statement"].includes(d.kind) &&
      d.required !== false,
  );
  const approved =
    Number(application) +
    Math.min(4, statements) +
    extra.filter((d) => d.status === "approved").length;
  const total = 5 + extra.length;
  return { approved, total, statements, ready: approved === total };
}
