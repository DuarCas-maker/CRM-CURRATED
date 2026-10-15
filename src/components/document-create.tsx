"use client";
import { useState } from "react";
import type { Document, Locale } from "@/lib/domain";
import type { Action } from "./crm";
import { t } from "./ui";

export function DocumentCreate({
  opportunityId,
  documents,
  locale,
  act,
  onCreated,
}: {
  opportunityId: string;
  documents: Document[];
  locale: Locale;
  act: Action;
  onCreated?: (id?: string) => void;
}) {
  const [kind, setKind] = useState("bank_statement"),
    [bank, setBank] = useState(""),
    [name, setName] = useState("");
  const [required, setRequired] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const banks = [...new Set(documents.map((d) => d.bank_name).filter(Boolean))];
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const result = await act("add_document", {
            opportunity_id: opportunityId,
            kind,
            name,
            bank_name: bank,
            required,
          });
          const created = result as
            { id?: string; document_id?: string } | undefined;
          setName("");
          onCreated?.(created?.document_id || created?.id);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <label className="field">
        {t(locale, "Tipo de documento", "Document type")}
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          disabled={busy}
        >
          <option value="bank_statement">
            {t(locale, "Extracto bancario", "Bank statement")}
          </option>
          <option value="additional">
            {t(locale, "Otro documento", "Other document")}
          </option>
          <option value="analysis_report">
            {t(locale, "Informe de análisis", "Analysis report")}
          </option>
        </select>
      </label>
      {kind === "bank_statement" ? (
        <label className="field">
          {t(locale, "Banco", "Bank")}
          <input
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            maxLength={120}
            required
            disabled={busy}
            list={`banks-${opportunityId}`}
            placeholder={t(
              locale,
              "Selecciona o escribe el banco",
              "Select or enter the bank",
            )}
          />
          <datalist id={`banks-${opportunityId}`}>
            {banks.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
      ) : (
        <>
          <label className="field">
            {t(locale, "Nombre del documento", "Document name")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              disabled={busy}
            />
          </label>
          <label className="document-review-confirm">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
              disabled={busy}
            />
            {t(locale, "Documento obligatorio", "Required document")}
          </label>
        </>
      )}
      <button
        className="button"
        disabled={
          busy || (kind === "bank_statement" ? !bank.trim() : !name.trim())
        }
      >
        {busy
          ? t(locale, "Guardando…", "Saving…")
          : t(locale, "Agregar documento", "Add document")}
      </button>
    </form>
  );
}
