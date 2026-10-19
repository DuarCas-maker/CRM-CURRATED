"use client";
import { useEffect, useState } from "react";
import type { Document, Locale, Workspace } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import type { DocumentSelection } from "@/lib/document-review";
import type { Action } from "./crm";
import { useUnsavedChanges } from "./unsaved-changes";
import { Modal, t } from "./ui";
import { GmailPdfPreview } from "./gmail-pdf-preview";
import { DocumentIntake } from "./document-intake";
import { documentLabel } from "@/lib/document-labels";

type Context = {
  name: string;
  opportunity: {
    id: string;
    company: string;
    contact: string;
    created_at: string;
  };
  documents: Document[];
  document_id: string | null;
  editable: boolean;
  versions: {
    id: string;
    content_hash: string;
    created_at: string;
    source_attachment_id?: string;
    source_gmail_file_id?: string;
  }[];
  reviews: {
    id: string;
    status: string;
    notes: string;
    reviewer_id: string;
    reviewed_at: string;
    content_hash: string;
  }[];
};
export function DocumentReview({
  selection,
  data,
  locale,
  act,
  close,
}: {
  selection: DocumentSelection;
  data: Workspace;
  locale: Locale;
  act: Action;
  close: () => void;
}) {
  const [current, setCurrent] = useState(selection);
  const [context, setContext] = useState<Context | null>(null);
  const [target, setTarget] = useState("");
  const [notes, setNotes] = useState("");
  const [bank, setBank] = useState("");
  const [status, setStatus] = useState("approved");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [preview, setPreview] = useState<{
    url: string;
    mime: string;
    hash: string | null;
  } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setContext(null);
    setError("");
    setConfirmed(false);
    (async () => {
      try {
        let body: Context;
        if (data.demo) {
          const attachment = data.attachments?.find((a) => a.id === current.id);
          const message = data.messages.find(
            (m) => m.id === attachment?.message_id,
          );
          const co = data.conversations.find(
            (c) => c.id === message?.conversation_id,
          );
          const doc = data.documents.find((d) => d.id === current.id);
          const opportunity = data.opportunities.find(
            (o) => o.id === (doc?.opportunity_id || co?.opportunity_id),
          );
          if (!opportunity) throw new Error("Document not found");
          body = {
            name: doc?.name || attachment?.name || "Document",
            opportunity,
            documents: data.documents.filter(
              (d) => d.opportunity_id === opportunity.id,
            ),
            document_id: doc?.id || attachment?.imported_document_id || null,
            editable: !opportunity.handed_off_at
              ? ["superadmin", "seller_admin", "seller"].includes(
                  data.profile.role,
                )
              : ["superadmin", "closer_admin", "closer"].includes(
                  data.profile.role,
                ),
            versions: [],
            reviews: [],
          };
        } else {
          const r = await fetch(
            `/api/documents/review?${new URLSearchParams(current)}`,
            { signal: controller.signal },
          );
          body = await r.json();
          if (!r.ok)
            throw new Error((body as unknown as { error: string }).error);
        }
        if (controller.signal.aborted) return;
        if (body.document_id && current.source !== "document") {
          setCurrent({ source: "document", id: body.document_id });
          return;
        }
        setContext(body);
        setTarget(
          (previous) =>
            body.document_id ||
            (body.documents.some((d) => d.id === previous) ? previous : "") ||
            body.documents.find((d) => d.status === "pending")?.id ||
            body.documents[0]?.id ||
            "",
        );
        const doc = body.documents.find((d) => d.id === body.document_id);
        setNotes(doc?.review_notes || "");
        setBank(doc?.bank_name || "");
        changes.markSaved({
          notes: doc?.review_notes || "",
          bank: doc?.bank_name || "",
          status: doc?.status === "correction" ? "correction" : "approved",
          confirmed: false,
        });
        setStatus(doc?.status === "correction" ? "correction" : "approved");
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
    })();
    return () => controller.abort();
    // Workspace polling must not overwrite an in-progress review.
  }, [current.source, current.id, reload, data.demo ? data.documents : null]);
  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    setPreview(null);
    setPreviewError("");
    if (data.demo) return;
    (async () => {
      try {
        const r = await fetch(
          `/api/documents/review?${new URLSearchParams({ ...current, preview: "true" })}`,
          { signal: controller.signal },
        );
        if (!r.ok) throw new Error((await r.json()).error);
        const blob = await r.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPreview({
          url,
          mime: blob.type,
          hash: r.headers.get("X-Document-Hash"),
        });
      } catch (e) {
        if (!controller.signal.aborted) setPreviewError((e as Error).message);
      }
    })();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [current.source, current.id, reload]);
  const doc = context?.documents.find(
    (d) => d.id === (context.document_id || target),
  );
  const changes = useUnsavedChanges(
    { notes, bank, status, confirmed },
    busy,
    !!context?.editable,
  );
  const incorporated = !!context?.document_id;
  useEffect(() => {
    setBank(doc?.bank_name || "");
  }, [doc?.id, doc?.bank_name]);
  async function save() {
    if (!context || !doc) return;
    setBusy(true);
    setError("");
    try {
      if (doc.kind === "bank_statement" && bank.trim() !== doc.bank_name) {
        await act("classify_document", {
          opportunity_id: context.opportunity.id,
          document_id: doc.id,
          bank_name: bank.trim(),
        });
      }
      await act("review_document", {
        opportunity_id: context.opportunity.id,
        document_id: doc.id,
        expected_hash: doc.content_hash || "demo",
        status,
        notes,
        period: doc.period || "",
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
      busy={busy}
      dirty={changes.dirty}
      locale={locale}
      wide
      title={t(locale, "Revisión documental", "Document review")}
      close={() => {
        if (!busy) close();
      }}
    >
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            type="button"
            className="text-button"
            onClick={() => setReload((n) => n + 1)}
          >
            {t(locale, "Recargar revisión", "Reload review")}
          </button>
        </div>
      )}
      {!context ? (
        <p role="status">
          {t(locale, "Cargando expediente…", "Loading case…")}
        </p>
      ) : (
        <>
          <p>
            <strong>{context.opportunity.company}</strong> ·{" "}
            {context.opportunity.contact}
            <br />
            <small>
              {t(locale, "Oportunidad creada", "Opportunity created")}:{" "}
              {dateLabel(context.opportunity.created_at, locale)} ·{" "}
              {context.opportunity.id.slice(0, 8)}
            </small>
          </p>
          <p>
            <strong>{context.name}</strong>
          </p>
          {incorporated && preview && preview.hash !== doc?.content_hash && (
            <p role="alert">
              {t(
                locale,
                "La versión del archivo cambió. Recarga la revisión antes de aprobar.",
                "The file version changed. Reload the review before approving.",
              )}
            </p>
          )}
          <div className="document-review-layout">
            <div className="document-review-preview">
              {data.demo ? (
                <p>
                  {t(
                    locale,
                    "Archivo ficticio de demostración; no se descarga información real.",
                    "Demo file; no real information is downloaded.",
                  )}
                </p>
              ) : previewError ? (
                <p role="alert">{previewError}</p>
              ) : !preview ? (
                <p role="status">
                  {t(locale, "Cargando archivo…", "Loading file…")}
                </p>
              ) : preview.mime === "application/pdf" ? (
                <GmailPdfPreview
                  url={preview.url}
                  name={context.name}
                  locale={locale}
                />
              ) : (
                <img src={preview.url} alt={context.name} />
              )}
            </div>
            <div>
              {!incorporated ? (
                <DocumentIntake
                  selection={current}
                  opportunityId={context.opportunity.id}
                  documents={context.documents}
                  filename={context.name}
                  previewHash={preview?.hash || null}
                  previewReady={!!preview}
                  editable={context.editable}
                  demo={!!data.demo}
                  locale={locale}
                  act={act}
                  close={close}
                />
              ) : (
                <>
                  <p>{doc && documentLabel(doc, locale)}</p>
                  <label className="field">
                    {t(locale, "Resultado de revisión", "Review outcome")}
                    <select
                      value={status}
                      disabled={!context.editable || busy}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="approved">
                        {t(locale, "Aprobar", "Approve")}
                      </option>
                      <option value="correction">
                        {t(locale, "Pedir corrección", "Request correction")}
                      </option>
                      <option value="received">
                        {t(
                          locale,
                          "Dejar pendiente de revisión",
                          "Keep pending review",
                        )}
                      </option>
                    </select>
                  </label>
                  <label className="field">
                    {t(
                      locale,
                      "Notas / corrección requerida",
                      "Notes / requested correction",
                    )}
                    <textarea
                      value={notes}
                      maxLength={4000}
                      disabled={!context.editable || busy}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </label>
                  {context.editable && (
                    <label className="document-review-confirm">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      {t(
                        locale,
                        doc?.kind === "application"
                          ? "Confirmé que la aplicación está completa, firmada y pertenece a esta empresa."
                          : "Revisé el contenido y confirmé que el archivo pertenece a esta empresa.",
                        doc?.kind === "application"
                          ? "I confirmed the application is complete, signed and belongs to this business."
                          : "I reviewed the contents and confirmed the file belongs to this business.",
                      )}
                    </label>
                  )}
                  <details>
                    <summary>
                      {t(
                        locale,
                        "Versiones e historial de revisión",
                        "Versions and review history",
                      )}{" "}
                      ({context.versions.length})
                    </summary>
                    {context.versions.map((v) => (
                      <p key={v.id}>
                        {dateLabel(v.created_at, locale, true)} ·{" "}
                        {v.content_hash.slice(0, 12)} ·{" "}
                        {v.source_gmail_file_id || v.source_attachment_id
                          ? t(locale, "Desde conversación", "From conversation")
                          : t(locale, "Carga de archivo", "File upload")}
                        {(v.source_gmail_file_id || v.source_attachment_id) && (
                          <a
                            target="_blank"
                            rel="noreferrer"
                            href={`/api/documents/review?${new URLSearchParams({ source: v.source_gmail_file_id ? "saved" : "legacy", id: v.source_gmail_file_id || v.source_attachment_id!, preview: "true" })}`}
                          >
                            {t(
                              locale,
                              " · Ver archivo de origen",
                              " · View source file",
                            )}
                          </a>
                        )}
                      </p>
                    ))}
                    {context.reviews.map((r) => (
                      <p key={r.id}>
                        {dateLabel(r.reviewed_at, locale, true)} ·{" "}
                        {data.profiles.find((p) => p.id === r.reviewer_id)
                          ?.name || t(locale, "Equipo", "Team")}{" "}
                        · {r.status} · {r.content_hash.slice(0, 12)}
                        <br />
                        {r.notes}
                      </p>
                    ))}
                  </details>
                </>
              )}
              {incorporated && doc?.kind === "bank_statement" && (
                <label className="field">
                  {t(locale, "Banco de este extracto", "Statement bank")}
                  <input
                    value={bank}
                    maxLength={120}
                    onChange={(e) => setBank(e.target.value)}
                    disabled={busy || !context.editable}
                    placeholder={t(
                      locale,
                      "Escribe el nombre del banco",
                      "Enter the bank name",
                    )}
                  />
                  <small>
                    {t(
                      locale,
                      "El período se identificará al analizar el archivo.",
                      "The statement period will be identified during file analysis.",
                    )}
                  </small>
                </label>
              )}
              {!context.editable && (
                <p>
                  {t(
                    locale,
                    "Solo tienes acceso de lectura a esta oportunidad.",
                    "You have read-only access to this opportunity.",
                  )}
                </p>
              )}
            </div>
          </div>
          {incorporated && (
            <div className="modal-footer">
              <button
                type="button"
                className="button primary"
                onClick={() => void save()}
                disabled={
                  busy ||
                  !context.editable ||
                  !doc ||
                  (doc.kind === "bank_statement" && !bank.trim()) ||
                  (!data.demo && !preview) ||
                  (!data.demo &&
                    incorporated &&
                    preview?.hash !== doc.content_hash) ||
                  (incorporated &&
                    (!confirmed || (status === "correction" && !notes.trim())))
                }
              >
                {busy
                  ? t(locale, "Guardando…", "Saving…")
                  : incorporated
                    ? t(locale, "Guardar revisión", "Save review")
                    : t(
                        locale,
                        "Incorporar a esta oportunidad",
                        "Add to this opportunity",
                      )}
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export function DocumentChecklistSetup({
  opportunityId,
  locale,
  act,
  onPrepared,
}: {
  opportunityId: string;
  locale: Locale;
  act: Action;
  onPrepared?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await act("initialize_document_checklist", {
              opportunity_id: opportunityId,
            });
            onPrepared?.();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? t(locale, "Preparando…", "Preparing…")
          : t(
              locale,
              "Crear checklist de aplicación y extractos",
              "Create application and statement checklist",
            )}
      </button>
    </div>
  );
}
