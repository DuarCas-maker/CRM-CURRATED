"use client";
import { useState } from "react";
import type { Document, Locale } from "@/lib/domain";
import { planBankMove } from "@/lib/bank-document-management";
import { documentLabel } from "@/lib/document-labels";
import type { Action } from "./crm";
import { useUnsavedChanges } from "./unsaved-changes";
import { Modal, t } from "./ui";
export function BankDocumentManagement({
  documents,
  selected,
  locale,
  act,
  close,
}: {
  documents: Document[];
  selected: string[];
  locale: Locale;
  act: Action;
  close: () => void;
}) {
  const statements = documents.filter((d) => d.kind === "bank_statement");
  const first = statements.find((d) => d.id === selected[0]);
  const [ids, setIds] = useState(selected),
    [bank, setBank] = useState(first?.bank_name || ""),
    [position, setPosition] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const changes = useUnsavedChanges({ ids, bank, position }, busy);
  const banks = [
    ...new Set(
      statements
        .map((d) => d.bank_name?.trim())
        .filter((v): v is string => !!v),
    ),
  ];
  const slots =
    statements.filter(
      (d) =>
        !ids.includes(d.id) &&
        (d.bank_name || "").trim().toLowerCase() === bank.trim().toLowerCase(),
    ).length + 1;
  const preview = bank.trim()
    ? planBankMove(
        documents,
        ids,
        bank.slice(0, 120),
        Math.min(position, slots),
      )
        .filter(
          (d) =>
            d.kind === "bank_statement" &&
            (d.bank_name || "").toLowerCase() === bank.trim().toLowerCase(),
        )
        .sort((a, b) => (a.statement_number || 0) - (b.statement_number || 0))
    : [];
  function shift(index: number, offset: number) {
    const next = [...ids];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setIds(next);
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await act("move_bank_documents", {
        opportunity_id: first!.opportunity_id,
        document_ids: ids,
        bank_name: bank.trim(),
        position: Math.min(position, slots),
        expected_documents: statements.map((d) => ({
          id: d.id,
          bank_name: d.bank_name || "",
          statement_number: d.statement_number ?? null,
        })),
      });
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      dirty={changes.dirty}
      busy={busy}
      locale={locale}
      title={t(
        locale,
        "Cambiar banco y ordenar extractos",
        "Change bank and order statements",
      )}
      close={() => {
        if (!busy) close();
      }}
    >
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <p>
        {t(
          locale,
          "El archivo y su aprobación se conservan. La numeración se reorganiza en los bancos afectados. Si un análisis utilizó el banco anterior, necesitará actualizarse.",
          "Files and approvals are preserved. Numbering is reorganized in affected banks. An analysis using the previous bank will need updating.",
        )}
      </p>
      <fieldset disabled={busy}>
        <label className="field">
          {t(locale, "Banco de destino", "Destination bank")}
          <select
            value={banks.includes(bank) ? bank : ""}
            onChange={(e) => {
              setBank(e.target.value);
              setPosition(1);
            }}
          >
            <option value="">
              {t(
                locale,
                "Nuevo banco / escribir nombre",
                "New bank / enter name",
              )}
            </option>
            {banks.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t(locale, "Nombre del banco", "Bank name")}
          <input
            value={bank}
            maxLength={120}
            onChange={(e) => {
              setBank(e.target.value);
              setPosition(1);
            }}
          />
        </label>
        <label className="field">
          {t(
            locale,
            "Insertar a partir de la posición",
            "Insert starting at position",
          )}
          <select
            value={Math.min(position, slots)}
            onChange={(e) => setPosition(Number(e.target.value))}
          >
            {Array.from({ length: slots }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <h3>
          {t(
            locale,
            "Orden de los extractos seleccionados",
            "Selected statement order",
          )}
        </h3>
        {ids.map((id, i) => {
          const d = statements.find((d) => d.id === id)!;
          return (
            <div className="bank-move-item" key={id}>
              <span>
                {d.bank_name ||
                  t(locale, "Banco por identificar", "Bank to identify")}{" "}
                · {documentLabel(d, locale)}
              </span>
              <button
                type="button"
                className="button"
                disabled={!i}
                aria-label={t(locale, "Subir", "Move up")}
                onClick={() => shift(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="button"
                disabled={i === ids.length - 1}
                aria-label={t(locale, "Bajar", "Move down")}
                onClick={() => shift(i, 1)}
              >
                ↓
              </button>
            </div>
          );
        })}
        <h3>
          {t(
            locale,
            "Así quedará el banco de destino",
            "Destination bank preview",
          )}
        </h3>
        <ol>
          {preview.map((d) => (
            <li key={d.id}>
              <strong>{documentLabel(d, locale)}</strong> ·{" "}
              {documentLabel(
                statements.find((original) => original.id === d.id)!,
                locale,
              )}{" "}
              (
              {statements.find((original) => original.id === d.id)?.bank_name ||
                t(locale, "Banco por identificar", "Bank to identify")}
              )
              {ids.includes(d.id)
                ? ` · ${t(locale, "seleccionado", "selected")}`
                : ""}
            </li>
          ))}
        </ol>
      </fieldset>
      <div className="modal-footer">
        <button
          className="button primary"
          disabled={busy || !bank.trim()}
          onClick={() => void save()}
        >
          {busy
            ? t(locale, "Guardando…", "Saving…")
            : t(
                locale,
                "Guardar cambio de banco y orden",
                "Save bank and order",
              )}
        </button>
      </div>
    </Modal>
  );
}
