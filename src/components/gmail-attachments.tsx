"use client";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/domain";
import {
  attachmentKey,
  type GmailAttachmentItem,
} from "@/lib/gmail-attachments";
import { Modal, t } from "./ui";
import { dateLabel } from "@/lib/domain";
import { GmailPdfPreview } from "./gmail-pdf-preview";
type Result = {
  files: GmailAttachmentItem[];
  formats: { format: string; count: number }[];
  total: number;
  all_count: number;
  selected_count: number;
  copied_count: number;
  hidden_count: number;
  reviewed: boolean;
};
type Choice = {
  archive_message_id: string;
  part_id: string;
  included: boolean;
};
function AttachmentPreview({
  file,
  locale,
  close,
}: {
  file: GmailAttachmentItem;
  locale: Locale;
  close: () => void;
}) {
  const [url, setUrl] = useState(""),
    [mime, setMime] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    (async () => {
      try {
        const r = await fetch(
          `/api/gmail/attachments/preview?${new URLSearchParams({ message: file.archive_message_id, part: file.part_id })}`,
          { signal: controller.signal },
        );
        if (!r.ok) throw new Error((await r.json()).error);
        const blob = await r.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setMime(blob.type);
        setUrl(objectUrl);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.archive_message_id, file.part_id]);
  return (
    <Modal title={file.name} wide close={close}>
      <p>
        {t(
          locale,
          "La vista previa no incorpora ni aprueba el documento.",
          "Previewing does not incorporate or approve this document.",
        )}
      </p>
      {error ? (
        <div className="error-banner">{error}</div>
      ) : !url ? (
        <p role="status">
          {t(locale, "Cargando vista previa…", "Loading preview…")}
        </p>
      ) : mime === "application/pdf" ? (
        <GmailPdfPreview url={url} name={file.name} locale={locale} />
      ) : (
        <img className="gmail-attachment-image" alt={file.name} src={url} />
      )}
    </Modal>
  );
}
export function GmailAttachments({
  runId,
  caseId,
  candidateId,
  locale,
  editable = true,
  confirmImport = false,
  close,
  saved,
  openSource,
}: {
  runId?: string;
  caseId?: string;
  candidateId?: string;
  locale: Locale;
  editable?: boolean;
  confirmImport?: boolean;
  close: () => void;
  saved: () => void | Promise<void>;
  openSource: (id: string) => void;
}) {
  const [data, setData] = useState<Result | null>(null),
    [formats, setFormats] = useState<string[]>([]),
    [showInline, setShowInline] = useState(false),
    [page, setPage] = useState(0);
  const [changes, setChanges] = useState<Record<string, Choice>>({}),
    [preview, setPreview] = useState<GmailAttachmentItem | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const p = new URLSearchParams({
      page: String(page),
      inline: String(showInline),
    });
    if (runId) p.set("run", runId);
    if (caseId) p.set("case", caseId);
    if (candidateId) p.set("candidate", candidateId);
    formats.forEach((f) => p.append("format", f));
    fetch(`/api/gmail/attachments?${p}`, { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        return body;
      })
      .then((body) => {
        if (!controller.signal.aborted) setData(body);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [runId, caseId, candidateId, page, formats, showInline]);
  function change(file: GmailAttachmentItem, included: boolean) {
    if (file.copied || (included && file.size > 20 * 1024 * 1024)) return;
    setChanges((current) => {
      const key = attachmentKey(file);
      const next = { ...current };
      if (included === (file.decision === "included")) {
        delete next[key];
        return next;
      }
      if (!next[key] && Object.keys(next).length >= 500) return current;
      next[key] = {
        archive_message_id: file.archive_message_id,
        part_id: file.part_id,
        included,
      };
      return next;
    });
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/gmail/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: runId || null,
          case_id: caseId || null,
          choices: Object.values(changes),
          mark_reviewed: !!runId && !candidateId,
          ...(candidateId ? { candidate_id: candidateId } : {}),
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setChanges({});
      await saved();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selected = (f: GmailAttachmentItem) =>
    f.copied ||
    (changes[attachmentKey(f)]?.included ?? f.decision === "included");
  const count = Object.keys(changes).length;
  const canClose = () => {
    if (busy) return;
    if (
      !count ||
      confirm(
        t(
          locale,
          "¿Cerrar sin guardar la selección?",
          "Close without saving your selection?",
        ),
      )
    )
      close();
  };
  return (
    <Modal
      title={t(locale, "Seleccionar adjuntos", "Select attachments")}
      wide
      close={canClose}
    >
      <p>
        {t(
          locale,
          "Marca únicamente los archivos que quieras incorporar. Los demás conservarán su referencia en Gmail. Los documentos ya copiados se mantienen.",
          "Select only files you want to incorporate. Others keep their Gmail reference. Already copied documents are preserved.",
        )}
      </p>
      {confirmImport && (
        <p>
          {candidateId
            ? t(
                locale,
                "Se incorporará únicamente este registro y sus adjuntos seleccionados. Los demás participantes seguirán pendientes. Puedes continuar sin copiar adjuntos.",
                "Only this record and its selected attachments will be incorporated. Other participants remain pending. You can continue without copying attachments.",
              )
            : t(
                locale,
                "Al continuar se incorporarán los participantes que elegiste y los adjuntos seleccionados asociados a sus expedientes. Puedes continuar sin copiar adjuntos.",
                "Continuing incorporates your chosen participants and selected attachments associated with their cases. You can continue without copying attachments.",
              )}
        </p>
      )}
      {data && (
        <p>
          {data.all_count}{" "}
          {t(locale, "adjuntos encontrados", "attachments found")} ·{" "}
          {data.selected_count}{" "}
          {t(locale, "seleccionados guardados", "saved selections")} ·{" "}
          {data.copied_count} {t(locale, "ya copiados", "already copied")}
        </p>
      )}
      <fieldset className="gmail-attachment-formats">
        <legend>{t(locale, "Filtrar por formato", "Filter by format")}</legend>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            setFormats([]);
            setPage(0);
          }}
        >
          {t(locale, "Todos los formatos", "All formats")}
        </button>
        {data?.formats.map((f) => (
          <label key={f.format}>
            <input
              type="checkbox"
              checked={formats.includes(f.format)}
              disabled={busy}
              onChange={(e) => {
                const checked = e.target.checked;
                setPage(0);
                setFormats((current) =>
                  checked
                    ? [...current, f.format]
                    : current.filter((v) => v !== f.format),
                );
              }}
            />
            {f.format} ({f.count})
          </label>
        ))}
      </fieldset>
      <label className="check-label">
        <input
          type="checkbox"
          checked={showInline}
          disabled={busy}
          onChange={(e) => {
            setShowInline(e.target.checked);
            setPage(0);
          }}
        />
        {t(
          locale,
          "Mostrar imágenes insertadas, logos y firmas (identificación orientativa)",
          "Show inline images, logos and signatures (suggested identification)",
        )}
        {data ? ` · ${data.hidden_count}` : ""}
      </label>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p role="status">
          {t(locale, "Cargando adjuntos…", "Loading attachments…")}
        </p>
      ) : (
        data && (
          <>
            {editable && (
              <div className="card-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => data.files.forEach((f) => change(f, true))}
                >
                  {t(locale, "Seleccionar esta página", "Select this page")}
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => data.files.forEach((f) => change(f, false))}
                >
                  {t(locale, "Desmarcar esta página", "Deselect this page")}
                </button>
              </div>
            )}
            <div className="table-scroll">
              <table className="gmail-attachments-table">
                <thead>
                  <tr>
                    <th>{t(locale, "Incluir", "Include")}</th>
                    <th>{t(locale, "Adjunto", "Attachment")}</th>
                    <th>{t(locale, "Correo de origen", "Source email")}</th>
                    <th>{t(locale, "Revisión", "Review")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.files.map((f) => (
                    <tr key={attachmentKey(f)}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${t(locale, "Incluir", "Include")} ${f.name}`}
                          checked={selected(f)}
                          disabled={
                            !editable ||
                            busy ||
                            f.copied ||
                            (count >= 500 && !changes[attachmentKey(f)]) ||
                            f.size > 20 * 1024 * 1024
                          }
                          onChange={(e) => change(f, e.target.checked)}
                        />
                      </td>
                      <td>
                        <strong>{f.name}</strong>
                        <small>
                          {f.format} · {(f.size / 1024).toFixed(1)} KB
                        </small>
                        <small>
                          {f.copied
                            ? t(locale, "Ya copiado", "Already copied")
                            : f.decision === "excluded"
                              ? t(
                                  locale,
                                  "Referencia; no seleccionado",
                                  "Reference; not selected",
                                )
                              : f.decision === "included"
                                ? t(
                                    locale,
                                    "Seleccionado para copiar",
                                    "Selected for copying",
                                  )
                                : t(
                                    locale,
                                    "Pendiente de selección",
                                    "Awaiting selection",
                                  )}
                        </small>
                        {f.suspected_inline && (
                          <small>
                            {t(
                              locale,
                              "Posible imagen insertada / firma",
                              "Possible inline image / signature",
                            )}
                          </small>
                        )}
                        {f.size > 20 * 1024 * 1024 && (
                          <small>
                            {t(
                              locale,
                              "Supera el límite de copia de 20 MB",
                              "Exceeds the 20 MB copy limit",
                            )}
                          </small>
                        )}
                        {f.last_error && (
                          <small className="error-banner">{f.last_error}</small>
                        )}
                      </td>
                      <td>
                        {f.subject}
                        <small>{dateLabel(f.sent_at, locale, true)}</small>
                        <small>
                          {f.participants
                            .filter((p) => p.role === "from")
                            .map((p) => p.email)
                            .join(", ")}
                        </small>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => openSource(f.archive_message_id)}
                        >
                          {t(locale, "Abrir correo", "Open email")}
                        </button>
                        {(f.format === "PDF" ||
                          f.mime_type.startsWith("image/")) &&
                          f.size <= 20 * 1024 * 1024 && (
                            <button
                              className="button"
                              onClick={() => setPreview(f)}
                            >
                              {t(locale, "Vista previa", "Preview")}
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.files.length && (
              <p>
                {t(
                  locale,
                  "No hay adjuntos con estos filtros.",
                  "No attachments match these filters.",
                )}
              </p>
            )}
            <div className="card-actions">
              <button
                className="button"
                disabled={busy || page === 0}
                onClick={() => setPage(page - 1)}
              >
                {t(locale, "Anterior", "Previous")}
              </button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(data.total / 50))} ·{" "}
                {data.total} {t(locale, "coincidencias", "matches")}
              </span>
              <button
                className="button"
                disabled={busy || (page + 1) * 50 >= data.total}
                onClick={() => setPage(page + 1)}
              >
                {t(locale, "Siguiente", "Next")}
              </button>
            </div>
          </>
        )
      )}
      <p>
        {count}{" "}
        {t(
          locale,
          "cambios sin guardar. Los filtros no cambian la selección.",
          "unsaved changes. Filters do not change selections.",
        )}
      </p>
      {count >= 500 && (
        <p role="alert">
          {t(
            locale,
            "Guarda hasta 500 cambios a la vez antes de continuar.",
            "Save up to 500 changes at a time before continuing.",
          )}
        </p>
      )}
      {editable && (
        <button
          className="button primary"
          disabled={busy || loading || !data || count > 500}
          onClick={save}
        >
          {confirmImport
            ? t(
                locale,
                "Guardar selección y continuar importación",
                "Save selection and continue import",
              )
            : t(
                locale,
                "Guardar selección de adjuntos",
                "Save attachment selection",
              )}
        </button>
      )}
      {preview && (
        <AttachmentPreview
          file={preview}
          locale={locale}
          close={() => setPreview(null)}
        />
      )}
    </Modal>
  );
}
