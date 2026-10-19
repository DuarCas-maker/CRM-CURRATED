"use client";
import { useEffect, useRef, useState } from "react";
import type { Document, Locale } from "@/lib/domain";
import type { DocumentSelection } from "@/lib/document-review";
import {
  intakeDestination,
  suggestBankFromFilename,
  documentSuggestionSchema,
  type IntakeKind,
} from "@/lib/document-intake";
import { documentLabel } from "@/lib/document-labels";
import type { Action } from "./crm";
import { t } from "./ui";
import { useNativeChanges } from "./unsaved-changes";
export function DocumentIntake({
  selection,
  opportunityId,
  documents,
  filename,
  previewHash,
  previewReady,
  editable,
  demo,
  locale,
  act,
  close,
  uploadFile,
}: {
  selection: DocumentSelection | { source: "upload"; id: string };
  uploadFile?: File;
  opportunityId: string;
  documents: Document[];
  filename: string;
  previewHash: string | null;
  previewReady: boolean;
  editable: boolean;
  demo: boolean;
  locale: Locale;
  act: Action;
  close: () => void;
}) {
  const bankSuggestion = suggestBankFromFilename(filename, documents);
  const [kind, setKind] = useState<IntakeKind | "">(""),
    [bank, setBank] = useState(bankSuggestion.bank),
    [name, setName] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [suggestion, setSuggestion] = useState<ReturnType<
      typeof documentSuggestionSchema.parse
    > | null>(null),
    [identifying, setIdentifying] = useState(false),
    [suggestionError, setSuggestionError] = useState(""),
    [retry, setRetry] = useState(0),
    [replace, setReplace] = useState("");
  const protection = useRef<HTMLDivElement>(null);
  useNativeChanges(protection, editable, false, busy);
  const manuallyChosen = useRef(false);
  useEffect(() => {
    if (demo || !editable || !previewHash || selection.source === "document")
      return;
    const controller = new AbortController();
    setIdentifying(true);
    setSuggestionError("");
    const payload = {
      ...selection,
      opportunity_id: opportunityId,
      expected_hash: previewHash,
      retry: retry > 0,
    };
    const form = new FormData();
    if (uploadFile) {
      form.set("file", uploadFile);
      form.set("payload", JSON.stringify(payload));
    }
    fetch("/api/documents/classify", {
      method: "POST",
      headers: uploadFile ? undefined : { "Content-Type": "application/json" },
      body: uploadFile ? form : JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error);
        if (controller.signal.aborted) return;
        const result = documentSuggestionSchema.parse(value.suggestion);
        setSuggestion(result);
        if (!manuallyChosen.current && result.kind !== "unknown") {
          setKind(result.kind);
          setName(result.name);
          setConfirmed(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setSuggestionError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIdentifying(false);
      });
    return () => controller.abort();
  }, [
    selection.source,
    selection.id,
    previewHash,
    editable,
    demo,
    retry,
    opportunityId,
    uploadFile,
  ]);
  const existing = documents.find((d) => d.id === replace);
  const destination = kind ? intakeDestination(documents, kind, bank) : null;
  const banks = [
    ...new Set(
      documents
        .filter((d) => d.kind === "bank_statement" && d.storage_path)
        .map((d) => d.bank_name)
        .filter((b): b is string => !!b),
    ),
  ];
  const valid =
    !!kind &&
    (kind !== "bank_statement" || !!bank.trim()) &&
    (kind !== "additional" || !!name.trim()) &&
    (previewReady || demo) &&
    editable &&
    !busy;
  async function save(approve: boolean) {
    if (!valid || (approve && !confirmed)) return;
    setBusy(true);
    setError("");
    try {
      if (
        existing &&
        !window.confirm(
          t(
            locale,
            "Este archivo tendrá una nueva versión. Su aprobación anterior no se conserva. ¿Continuar?",
            "This file will have a new version. Its previous approval will not be retained. Continue?",
          ),
        )
      )
        return;
      await act("receive_document", {
        opportunity_id: opportunityId,
        source: selection.source,
        source_id: selection.id,
        kind,
        bank_name: kind === "bank_statement" ? bank.trim() : "",
        name,
        expected_source_hash:
          previewHash ||
          Array.from(selection.id)
            .map((char) => char.charCodeAt(0).toString(16))
            .join("")
            .padEnd(64, "0")
            .slice(0, 64),
        approve,
        confirmed,
        replace_document_id: existing?.id || null,
        expected_target_hash: existing?.content_hash || null,
      });
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div ref={protection} className="document-intake">
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {identifying && (
        <p role="status">
          {t(
            locale,
            "Identificando el tipo por el contenido…",
            "Identifying document type from its contents…",
          )}
        </p>
      )}
      {suggestion && (
        <p role="status">
          {t(locale, "Sugerencia por contenido: ", "Content suggestion: ")}
          {locale === "es" ? suggestion.reason_es : suggestion.reason_en}{" "}
          {t(
            locale,
            "Puedes corregir el tipo antes de guardar.",
            "You can correct the type before saving.",
          )}
        </p>
      )}
      {suggestionError && (
        <div role="status">
          <p>{suggestionError}</p>
          <button
            className="button"
            disabled={identifying || busy}
            onClick={() => setRetry((n) => n + 1)}
          >
            {t(locale, "Reintentar identificación", "Retry identification")}
          </button>
        </div>
      )}
      {demo && (
        <p>
          {t(
            locale,
            "Demostración: elige el tipo de documento. La lectura por IA se activa en oportunidades reales.",
            "Demo: choose a document type. AI content reading is available for real opportunities.",
          )}
        </p>
      )}
      <label className="field">
        {t(locale, "Tipo de documento", "Document type")}
        <select
          value={kind}
          disabled={busy || !editable || !!replace}
          onChange={(e) => {
            manuallyChosen.current = true;
            setKind(e.target.value as IntakeKind);
            setConfirmed(false);
          }}
        >
          <option value="">
            {t(locale, "Selecciona el tipo…", "Select the type…")}
          </option>
          <option value="bank_statement">
            {t(locale, "Extracto bancario", "Bank statement")}
          </option>
          <option value="application">
            {t(locale, "Aplicación firmada", "Signed application")}
          </option>
          <option value="additional">
            {t(locale, "Otro documento", "Other document")}
          </option>
        </select>
      </label>
      {kind === "bank_statement" && (
        <label className="field">
          {t(locale, "Banco (obligatorio)", "Bank (required)")}
          <input
            value={bank}
            list={`intake-banks-${selection.id}`}
            maxLength={120}
            disabled={busy || !editable}
            placeholder={t(
              locale,
              "Selecciona o escribe el banco",
              "Select or enter the bank",
            )}
            onChange={(e) => {
              setBank(e.target.value);
              setConfirmed(false);
            }}
          />
          <datalist id={`intake-banks-${selection.id}`}>
            {banks.map((bank) => (
              <option key={bank} value={bank} />
            ))}
          </datalist>
          {bankSuggestion.source && (
            <small>
              {bankSuggestion.source === "filename"
                ? t(
                    locale,
                    "Sugerido por el nombre del archivo; confirma o corrige el banco.",
                    "Suggested from the filename; confirm or correct the bank.",
                  )
                : t(
                    locale,
                    "Precargado con el único banco que tiene archivos en esta oportunidad; puedes cambiarlo.",
                    "Prefilled with the only bank with files in this opportunity; you can change it.",
                  )}
            </small>
          )}
        </label>
      )}
      {kind === "additional" && (
        <label className="field">
          {t(locale, "Nombre del documento", "Document name")}
          <input
            value={name}
            maxLength={200}
            disabled={busy || !editable}
            onChange={(e) => {
              setName(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
      )}
      {kind && (
        <p className="intake-destination">
          <strong>{t(locale, "Se guardará como:", "Will be saved as:")}</strong>
          <br />
          {existing
            ? documentLabel(existing, locale)
            : kind === "bank_statement"
              ? `${t(locale, "Extracto bancario", "Bank Statement")} ${destination?.number}`
              : kind === "application"
                ? t(locale, "Aplicación firmada", "Signed application")
                : name || t(locale, "Indica un nombre", "Enter a name")}
          {kind === "bank_statement" && bank.trim() ? ` · ${bank.trim()}` : ""}
        </p>
      )}
      <p className="muted">
        {t(
          locale,
          "Guardar lo deja recibido y pendiente de aprobación. Guardar y aprobar requiere revisar el archivo y marcar la confirmación.",
          "Save marks it received and pending approval. Save and approve requires reviewing the file and checking the confirmation.",
        )}
      </p>
      <label className="document-review-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy || !editable || (!previewReady && !demo)}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {t(
          locale,
          kind === "application"
            ? "Revisé el archivo y confirmé que la aplicación está completa, firmada y pertenece a esta empresa."
            : "Revisé el archivo y confirmé su tipo, banco cuando corresponde y que pertenece a esta empresa.",
          kind === "application"
            ? "I reviewed the file and confirmed the application is complete, signed and belongs to this business."
            : "I reviewed the file and confirmed its type, bank when applicable, and that it belongs to this business.",
        )}
      </label>
      <div className="intake-actions">
        <button
          className="button"
          disabled={!valid}
          onClick={() => void save(false)}
        >
          {t(locale, "Guardar", "Save")}
        </button>
        <button
          className="button primary"
          disabled={!valid || !confirmed}
          onClick={() => void save(true)}
        >
          {t(locale, "Guardar y aprobar", "Save and approve")}
        </button>
      </div>
      {documents.some((d) => d.storage_path) && (
        <details>
          <summary>
            {t(
              locale,
              "Reemplazar un archivo existente",
              "Replace an existing file",
            )}
          </summary>
          <label className="field">
            {t(
              locale,
              "Archivo que tendrá una nueva versión",
              "File to receive a new version",
            )}
            <select
              value={replace}
              disabled={busy || !editable}
              onChange={(e) => {
                setReplace(e.target.value);
                setConfirmed(false);
                const d = documents.find((d) => d.id === e.target.value);
                if (d) {
                  manuallyChosen.current = true;
                  setKind(d.kind as IntakeKind);
                  setBank(d.bank_name || "");
                  setName(d.name);
                }
              }}
            >
              <option value="">
                {t(
                  locale,
                  "Guardar como un archivo nuevo",
                  "Save as a new file",
                )}
              </option>
              {documents
                .filter(
                  (d) =>
                    d.storage_path &&
                    ["bank_statement", "application", "additional"].includes(
                      d.kind,
                    ),
                )
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.bank_name ? `${d.bank_name} · ` : ""}
                    {documentLabel(d, locale)}
                  </option>
                ))}
            </select>
          </label>
        </details>
      )}
    </div>
  );
}
