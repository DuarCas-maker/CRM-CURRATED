import type { Document } from "./domain";
export function planBankMove(
  documents: Document[],
  ids: string[],
  bank: string,
  position: number,
) {
  const statements = documents.filter((d) => d.kind === "bank_statement");
  const key = (name = "") => name.trim().toLowerCase();
  bank = bank.trim();
  if (!bank || bank.length > 120)
    throw new Error("Indica el banco / Enter the bank");
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !statements.some((d) => d.id === id))
  )
    throw new Error("Selecciona extractos válidos / Select valid statements");
  bank =
    statements.find((d) => key(d.bank_name) === key(bank))?.bank_name || bank;
  const sort = (a: Document, b: Document) =>
    (a.statement_number || 0) - (b.statement_number || 0) ||
    a.created_at.localeCompare(b.created_at) ||
    a.id.localeCompare(b.id);
  const remaining = statements
    .filter((d) => !ids.includes(d.id) && key(d.bank_name) === key(bank))
    .sort(sort);
  if (
    !Number.isInteger(position) ||
    position < 1 ||
    position > remaining.length + 1
  )
    throw new Error("Posición inválida / Invalid position");
  const target = [...remaining];
  target.splice(
    position - 1,
    0,
    ...ids.map((id) => statements.find((d) => d.id === id)!),
  );
  const changes = new Map<string, Document>(
    target.map((d, i) => [
      d.id,
      {
        ...d,
        bank_name: bank,
        statement_number: i + 1,
        name: `Bank Statement ${i + 1}`,
      },
    ]),
  );
  const sources = new Set(
    statements.filter((d) => ids.includes(d.id)).map((d) => key(d.bank_name)),
  );
  sources.delete(key(bank));
  for (const source of sources)
    statements
      .filter((d) => key(d.bank_name) === source && !ids.includes(d.id))
      .sort(sort)
      .forEach((d, i) =>
        changes.set(d.id, {
          ...d,
          statement_number: i + 1,
          name: `Bank Statement ${i + 1}`,
        }),
      );
  return documents.map((d) => changes.get(d.id) || d);
}
