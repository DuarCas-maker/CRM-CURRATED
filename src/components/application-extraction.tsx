"use client";
import { useState } from "react";
import type { Document, Locale } from "@/lib/domain";
import {
  extractionSchema,
  type ExtractionItem,
} from "@/lib/application-extraction";
import { t } from "./ui";

export function ApplicationExtraction({
  documents,
  opportunityId,
  locale,
  busy,
  setBusy,
  onResult,
  onPending,
}: {
  documents: Document[];
  opportunityId: string;
  locale: Locale;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onResult: (fields: ExtractionItem[], sources: string[]) => void;
  onPending: (value: boolean) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [uploads, setUploads] = useState<File[]>([]),
    [confirmed, setConfirmed] = useState(""),
    [error, setError] = useState(""),
    [running, setRunning] = useState(false);
  const count = selected.length + uploads.length;
  async function extract() {
    setError("");
    setBusy(true);
    setRunning(true);
    try {
      if (count < 1 || count > 2)
        throw new Error(
          t(
            locale,
            "Selecciona uno o dos archivos en total.",
            "Select one or two files in total.",
          ),
        );
      const form = new FormData();
      form.set(
        "payload",
        JSON.stringify({
          opportunity_id: opportunityId,
          document_ids: selected,
          confirmed,
        }),
      );
      uploads.forEach((file) => form.append("files", file));
      const response = await fetch("/api/company-application/extract", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onResult(extractionSchema.parse(result).fields, [
        ...selected.map((id) => documents.find((d) => d.id === id)!.name),
        ...uploads.map((f) => f.name),
      ]);
      setUploads([]);
      setConfirmed("");
      onPending(false);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      setRunning(false);
    }
  }
  return (
    <details className="application-extraction">
      <summary>
        {t(locale, "Completar datos con AI", "Fill details with AI")}
      </summary>
      <p>
        {t(
          locale,
          "Selecciona hasta dos documentos entre los del expediente y los de tu equipo. Revisa los campos completados antes de guardar. Las subidas de este panel se usan únicamente para extraer datos.",
          "Select up to two documents from this opportunity and your computer. Review the completed fields before saving. Files uploaded here are used only for extraction.",
        )}
      </p>
      <fieldset disabled={busy}>
        <legend>
          {t(
            locale,
            "Documentos de esta oportunidad",
            "Documents in this opportunity",
          )}
        </legend>
        {documents
          .filter((d) => d.storage_path)
          .map((doc) => (
            <label className="document-review-confirm" key={doc.id}>
              <input
                type="checkbox"
                checked={selected.includes(doc.id)}
                disabled={busy || (!selected.includes(doc.id) && count >= 2)}
                onChange={(e) => {
                  setSelected(
                    e.target.checked
                      ? [...selected, doc.id]
                      : selected.filter((id) => id !== doc.id),
                  );
                  onPending(true);
                }}
              />
              {doc.bank_name ? `${doc.bank_name} - ` : ""}
              {doc.name}
            </label>
          ))}
        {!documents.some((d) => d.storage_path) && (
          <p className="muted">
            {t(
              locale,
              "No hay archivos incorporados. Puedes subirlos desde tu equipo.",
              "No files attached. You can upload from your computer.",
            )}
          </p>
        )}
      </fieldset>
      <label className="field">
        <span>
          {t(
            locale,
            "Archivos del equipo (PDF, JPG o PNG; máximo 20 MB cada uno)",
            "Computer files (PDF, JPG or PNG; up to 20 MB each)",
          )}
        </span>
        <input
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png"
          disabled={busy || count >= 2}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length + count > 2) {
              setError(
                t(
                  locale,
                  "El máximo es dos archivos en total.",
                  "The maximum is two files in total.",
                ),
              );
              return;
            }
            if (files.some((f) => !f.size || f.size > 20 * 1024 * 1024)) {
              setError(
                t(
                  locale,
                  "Cada archivo debe tener entre 1 byte y 20 MB.",
                  "Each file must be between 1 byte and 20 MB.",
                ),
              );
              return;
            }
            setUploads([...uploads, ...files]);
            setError("");
            onPending(true);
          }}
        />
      </label>
      {uploads.map((file, i) => (
        <p key={i}>
          {file.name}{" "}
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => setUploads(uploads.filter((_, j) => j !== i))}
          >
            {t(locale, "Quitar", "Remove")}
          </button>
        </p>
      ))}
      <label className="field">
        <span>
          {t(
            locale,
            "Datos confirmados por el usuario",
            "User-confirmed details",
          )}
        </span>
        <textarea
          rows={4}
          maxLength={8000}
          disabled={busy}
          value={confirmed}
          placeholder={t(
            locale,
            "Puedes pegar datos confirmados, indicando a quién pertenece cada uno.",
            "Paste confirmed facts and identify the person or company each belongs to.",
          )}
          onChange={(e) => {
            setConfirmed(e.target.value);
            onPending(true);
          }}
        />
      </label>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button primary"
        disabled={busy || count < 1 || count > 2}
        onClick={() => void extract()}
      >
        {running
          ? t(locale, "Extrayendo datos…", "Extracting details…")
          : t(
              locale,
              `Extraer datos (${count}/2)`,
              `Extract details (${count}/2)`,
            )}
      </button>
    </details>
  );
}
