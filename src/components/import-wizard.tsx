"use client";
import { ProtectedForm } from "./unsaved-changes";
import { useState, type FormEvent } from "react";
import { Upload, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { detectMapping, type Mapping } from "@/lib/imports";
import type { Locale, Workspace } from "@/lib/domain";
import type { Action } from "./crm";
import { Modal, Field, SaveButton, t } from "./ui";
export function ImportWizard({
  locale,
  close,
  data,
  act,
  refresh,
}: {
  locale: Locale;
  close: () => void;
  data: Workspace;
  act: Action;
  refresh: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [total, setTotal] = useState(0);
  const [mapping, setMapping] = useState<Mapping>(detectMapping([]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function preview(selected: File, chosen = "") {
    setBusy(true);
    setError("");
    try {
      if (selected.size > 50 * 1024 * 1024) throw new Error("Maximum 50 MB");
      const form = new FormData();
      form.set("file", selected);
      form.set("sheet", chosen);
      const res = await fetch(
        `/api/import/preview${data.demo ? "?demo=1" : ""}`,
        { method: "POST", body: form },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setHeaders(body.headers);
      setRows(body.rows);
      setSheets(body.sheets);
      setSheet(body.sheet);
      setTotal(body.total);
      setMapping(detectMapping(body.headers));
      setFile(selected);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (data.demo)
        await act("import_demo", { name: file!.name, rows, mapping, total });
      else {
        const body = new FormData();
        body.set("file", file!);
        body.set("sheet", sheet);
        body.set("mapping", JSON.stringify(mapping));
        body.set("idempotency_key", crypto.randomUUID());
        const res = await fetch("/api/import", { method: "POST", body });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        await refresh();
      }
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      busy={busy}
      dirty={!done && !!file}
      locale={locale}
      title={t(locale, "Importar una base de leads", "Import a lead list")}
      close={close}
      wide
    >
      <div className="import-steps">
        <span className={!file ? "active" : ""}>
          1. {t(locale, "Archivo", "File")}
        </span>
        <span className={file && !done ? "active" : ""}>
          2. {t(locale, "Mapeo y revisión", "Map & review")}
        </span>
        <span className={done ? "active" : ""}>
          3. {t(locale, "Procesamiento", "Processing")}
        </span>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {done ? (
        <div className="import-success">
          <CheckCircle2 size={45} />
          <h2>{t(locale, "Importación registrada", "Import registered")}</h2>
          <p>
            {data.demo
              ? t(
                  locale,
                  "En esta demostración solo se importan las filas de la vista previa.",
                  "This demo imports only the preview rows.",
                )
              : t(
                  locale,
                  "La carga continuará en segundo plano. Consulta el progreso en los lotes de importación.",
                  "Processing will continue in the background. Check progress in import batches.",
                )}
          </p>
          <button className="button primary" onClick={close}>
            {t(locale, "Volver a leads", "Back to leads")}
          </button>
        </div>
      ) : (
        <ProtectedForm busy={busy} onSubmit={submit}>
          {!file ? (
            <label className="upload-zone">
              <Upload size={32} />
              <strong>
                {t(locale, "Selecciona tu archivo", "Choose your file")}
              </strong>
              <span>
                CSV / XLSX ·{" "}
                {t(
                  locale,
                  "hasta 50 MB y 50.000 filas",
                  "up to 50 MB and 50,000 rows",
                )}
              </span>
              <input
                type="file"
                accept=".csv,.xlsx"
                disabled={busy}
                onChange={(e) => {
                  if (e.target.files?.[0]) preview(e.target.files[0]);
                }}
              />
            </label>
          ) : (
            <>
              <div className="file-summary">
                <FileSpreadsheet size={22} />
                <strong>{file.name}</strong>
                <span>
                  {total.toLocaleString()} {t(locale, "filas", "rows")}
                </span>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setFile(null)}
                >
                  {t(locale, "Cambiar", "Change")}
                </button>
              </div>
              {sheets.length > 1 && (
                <label className="field">
                  <span>{t(locale, "Hoja del libro", "Worksheet")}</span>
                  <select
                    value={sheet}
                    onChange={(e) => preview(file, e.target.value)}
                  >
                    {sheets.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
              <p>
                {t(
                  locale,
                  "Detectamos estas columnas. Confirma o ajusta el mapeo antes de continuar.",
                  "We detected these columns. Confirm or adjust the mapping before continuing.",
                )}
              </p>
              <div className="mapping-grid">
                {Object.keys(mapping).map((key) => (
                  <label className="field" key={key}>
                    <span>
                      {key}
                      {key === "email" ? " *" : ""}
                    </span>
                    <select
                      required={key === "email"}
                      value={mapping[key as keyof Mapping]}
                      onChange={(e) =>
                        setMapping({ ...mapping, [key]: e.target.value })
                      }
                    >
                      <option value="">
                        {t(locale, "Sin asignar", "Not mapped")}
                      </option>
                      {headers.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="table-scroll preview-table">
                <table>
                  <thead>
                    <tr>
                      {headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        {headers.map((h) => (
                          <td key={h}>{r[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="info-banner">
                {t(
                  locale,
                  "Los correos existentes se vinculan al lote sin sobrescribir el contacto ni su historial.",
                  "Existing emails are linked to the batch without overwriting the contact or history.",
                )}
              </div>
              <div className="modal-footer">
                <SaveButton
                  busy={busy}
                  locale={locale}
                  label={t(locale, "Confirmar importación", "Confirm import")}
                />
              </div>
            </>
          )}
          {busy && (
            <p role="status">
              {t(locale, "Procesando archivo…", "Processing file…")}
            </p>
          )}
        </ProtectedForm>
      )}
    </Modal>
  );
}
