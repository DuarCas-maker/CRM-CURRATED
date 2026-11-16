"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { Locale, Workspace } from "@/lib/domain";
import type { EmailTemplate } from "@/lib/campaign-templates";
import {
  campaignImportStatusSchema,
  campaignImportSteps,
  importCampaignHref,
  type CampaignImportStatus,
} from "@/lib/campaign-import";
import type { Action } from "../crm";
import { ImportWizard } from "../import-wizard";
import { CampaignComposer } from "../campaign-composer";
import { useProtection } from "../unsaved-changes";
import { t } from "../ui";
import "./campaign-import-flow.css";

export function CampaignImportFlow({
  data,
  locale,
  act,
  refresh,
  initialTemplate,
  close,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  refresh: () => Promise<void>;
  initialTemplate: EmailTemplate | null;
  close: () => void;
}) {
  const manage = ["superadmin", "seller_admin"].includes(data.profile.role);
  const [batch, setBatch] = useState("");
  const [status, setStatus] = useState<CampaignImportStatus | null>(null);
  const [importing, setImporting] = useState(false),
    [confirm, setConfirm] = useState(false),
    [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const verifyKeys = useRef(new Map<string, string>());
  const rootRef = useRef<HTMLElement>(null);
  useProtection({
    element: () => rootRef.current,
    dirty: () => false,
    busy: () => busy,
  });
  useEffect(() => {
    setStatus(null);
    setConfirm(false);
    setComposing(false);
    setNotice("");
  }, [batch]);
  useEffect(() => {
    if (!batch || data.demo || !manage) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(importCampaignHref(batch), {
          signal: controller.signal,
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        const parsed = campaignImportStatusSchema.parse(result);
        if (!controller.signal.aborted) {
          setStatus(parsed);
          if (
            ["queued", "running"].includes(parsed.batch.status) ||
            parsed.counts.running > 0
          )
            timer = setTimeout(() => void read(), 5000);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [batch, data.demo, manage, revision]);
  const next = status?.next_verification_count || 0;
  async function verify() {
    if (!status || !next || busy || data.demo) return;
    setBusy(true);
    setError("");
    setNotice("");
    const fingerprint = `${batch}:${next}`;
    let request_key = verifyKeys.current.get(fingerprint);
    if (!request_key) {
      request_key = crypto.randomUUID();
      verifyKeys.current.set(fingerprint, request_key);
    }
    try {
      const response = await fetch("/api/campaigns/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "verify",
          batch,
          expected_count: next,
          request_key,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      verifyKeys.current.delete(fingerprint);
      setConfirm(false);
      setRevision((x) => x + 1);
      setNotice(
        t(
          locale,
          `Verificación aprobada para ${result.queued ?? next} contactos. La campaña sigue sin activar.`,
          `Verification approved for ${result.queued ?? next} contacts. The campaign is not active.`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
      setRevision((x) => x + 1);
    } finally {
      setBusy(false);
    }
  }
  const step = composing
    ? 3
    : !batch
      ? 0
      : status?.batch.status !== "completed"
        ? 1
        : 2;
  if (!manage)
    return (
      <p className="pos-info">
        {t(
          locale,
          "La creación de campañas requiere un administrador con MFA.",
          "Campaign creation requires an administrator with MFA.",
        )}
      </p>
    );
  return (
    <section
      ref={rootRef}
      className="ci-flow"
      aria-label={t(
        locale,
        "Crear campaña desde un archivo",
        "Create a campaign from a file",
      )}
      aria-busy={busy}
    >
      <header className="ci-heading">
        <div>
          <span className="ci-eyebrow">
            {t(
              locale,
              "DE TU ARCHIVO A UNA CONVERSACIÓN",
              "FROM YOUR FILE TO A CONVERSATION",
            )}
          </span>
          <h2>{t(locale, "Crear campaña", "Create campaign")}</h2>
          <p>
            {t(
              locale,
              "Una base, una audiencia revisada y un envío que tú decides.",
              "One import, a reviewed audience, and a send you decide.",
            )}
          </p>
        </div>
        <FileSpreadsheet size={32} />
      </header>
      <ol
        className="ci-steps"
        aria-label={t(locale, "Etapas de la campaña", "Campaign stages")}
      >
        {campaignImportSteps.map(([es, en], i) => (
          <li
            key={en}
            aria-current={i === step ? "step" : undefined}
            className={i === step ? "current" : i < step ? "complete" : ""}
          >
            <span>{i < step ? <Check size={14} /> : i + 1}</span>
            {t(locale, es, en)}
          </li>
        ))}
      </ol>
      {data.demo && (
        <p className="pos-info">
          {t(
            locale,
            "Demostración del recorrido. Las verificaciones, campañas y métricas requieren datos reales y no se ejecutan en demo.",
            "Workflow demo. Verification, campaigns and metrics require real data and do not run in demo.",
          )}
        </p>
      )}
      <div className="ci-source pos-card">
        <div>
          <h3>
            {t(
              locale,
              "1. Elige la base de contactos",
              "1. Choose your contact list",
            )}
          </h3>
          <p className="pos-muted">
            {t(
              locale,
              "Reutiliza el importador del CRM: columnas, limpieza, duplicados y errores permanecen en el mismo lote.",
              "Reuse CRM import: columns, cleanup, duplicates and errors stay in the same batch.",
            )}
          </p>
        </div>
        <div className="ci-source-controls">
          <button
            className="pos-btn pos-primary"
            disabled={busy}
            onClick={() => setImporting(true)}
          >
            <Upload size={16} />
            {t(locale, "Cargar Excel / CSV", "Upload Excel / CSV")}
          </button>
          <label>
            {t(
              locale,
              "O retoma un archivo importado",
              "Or resume an imported file",
            )}
            <select
              value={batch}
              disabled={busy}
              onChange={(e) => {
                setBatch(e.target.value);
                setError("");
              }}
            >
              <option value="">
                {t(locale, "Selecciona un lote", "Choose an import")}
              </option>
              {status &&
                !data.imports.some((x) => x.id === status.batch.id) && (
                  <option value={status.batch.id}>{status.batch.name}</option>
                )}
              {data.imports.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {error && (
        <p className="pos-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="pos-notice" role="status">
          {notice}
        </p>
      )}
      {loading && !status && (
        <p role="status">
          {t(locale, "Consultando el lote…", "Loading import…")}
        </p>
      )}
      {batch && !data.demo && (
        <button
          className="pos-btn ci-refresh"
          disabled={busy || loading}
          onClick={() => setRevision((x) => x + 1)}
        >
          <RefreshCw size={14} />
          {t(locale, "Actualizar progreso", "Refresh progress")}
        </button>
      )}
      {status && (
        <>
          <section className="pos-card ci-review">
            <div className="ci-section-title">
              <div>
                <h3>
                  {t(locale, "2. Revisión del archivo", "2. File review")}
                </h3>
                <p>{status.batch.name}</p>
              </div>
              <span className="ci-status">
                {status.batch.status === "completed"
                  ? t(locale, "Procesado", "Processed")
                  : ["queued", "running"].includes(status.batch.status)
                    ? t(locale, "En procesamiento", "Processing")
                    : t(locale, "Requiere revisión", "Needs review")}
              </span>
            </div>
            <div className="ci-metrics">
              {[
                [
                  "Filas procesadas",
                  "Processed rows",
                  `${status.batch.processed} / ${status.batch.total}`,
                ],
                [
                  "Contactos únicos",
                  "Unique contacts",
                  status.counts.unique_contacts,
                ],
                ["Duplicados", "Duplicates", status.batch.duplicates],
                [
                  "Errores de importación",
                  "Import errors",
                  status.batch.errors,
                ],
              ].map(([es, en, n]) => (
                <div key={es}>
                  <span>{t(locale, String(es), String(en))}</span>
                  <strong>{n}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="pos-card ci-verification">
            <div className="ci-section-title">
              <div>
                <h3>
                  {t(
                    locale,
                    "3. Aprobación y clasificación con Bouncer",
                    "3. Approval and classification with Bouncer",
                  )}
                </h3>
                <p>
                  {t(
                    locale,
                    "Los válidos previos se reutilizan. Los dudosos, inválidos, bajas y errores no se enviarán.",
                    "Previously valid contacts are reused. Uncertain, invalid, suppressed and errored contacts will not be sent.",
                  )}
                </p>
              </div>
              <ShieldCheck size={24} />
            </div>
            <div className="ci-metrics ci-classification">
              {[
                ["Válidos", "Valid", status.counts.valid, "good"],
                ["Dudosos", "Uncertain", status.counts.uncertain, "warn"],
                ["Inválidos", "Invalid", status.counts.invalid, "bad"],
                ["Por verificar", "To verify", status.counts.pending, ""],
                ["En verificación", "Verifying", status.counts.running, ""],
                [
                  "Requieren revisión",
                  "Need review",
                  status.counts.attention,
                  "warn",
                ],
              ].map(([es, en, n, tone]) => (
                <div key={es} className={String(tone)}>
                  <span>{t(locale, String(es), String(en))}</span>
                  <strong>{n}</strong>
                </div>
              ))}
            </div>
            {!!status.counts.attention && (
              <p className="pos-info">
                {t(
                  locale,
                  "Los errores técnicos o resultados inciertos requieren revisión en Preparación de leads. No se repetirán automáticamente ni entrarán en el envío.",
                  "Technical errors or uncertain requests require review in Lead preparation. They will not be retried automatically or included in sending.",
                )}
              </p>
            )}
            {confirm ? (
              <div
                className="ci-confirm"
                role="group"
                aria-label={t(
                  locale,
                  "Confirmar uso de Bouncer",
                  "Confirm Bouncer usage",
                )}
              >
                <strong>
                  {t(
                    locale,
                    `¿Aprobar la verificación de ${next} contactos?`,
                    `Approve verification of ${next} contacts?`,
                  )}
                </strong>
                <p>
                  {t(
                    locale,
                    "Se consumirán créditos de Bouncer. No se enviarán correos ni se activará la campaña.",
                    "This uses Bouncer credits. No emails will be sent and the campaign will not be activated.",
                  )}
                </p>
                <div className="pos-row">
                  <button
                    className="pos-btn pos-primary"
                    disabled={busy}
                    onClick={() => void verify()}
                  >
                    {busy
                      ? t(locale, "Solicitando…", "Requesting…")
                      : t(
                          locale,
                          "Confirmar verificación",
                          "Confirm verification",
                        )}
                  </button>
                  <button
                    className="pos-btn"
                    disabled={busy}
                    onClick={() => setConfirm(false)}
                  >
                    {t(locale, "Cancelar", "Cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="pos-row">
                <button
                  className="pos-btn"
                  disabled={
                    busy ||
                    !next ||
                    status.batch.status !== "completed" ||
                    data.demo
                  }
                  onClick={() => setConfirm(true)}
                >
                  <ShieldCheck size={15} />
                  {t(
                    locale,
                    `Verificar ${next} pendientes`,
                    `Verify ${next} pending`,
                  )}
                </button>
                <button
                  className="pos-btn pos-primary"
                  disabled={busy || !status.ready || data.demo}
                  onClick={() => setComposing(true)}
                >
                  {t(
                    locale,
                    "Continuar con plantilla y remitente",
                    "Continue with template and sender",
                  )}
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
          </section>
          {composing && status.ready && (
            <section className="pos-card ci-compose">
              <h3>
                {t(
                  locale,
                  "4. Plantilla, destinatarios y activación manual",
                  "4. Template, recipients and manual activation",
                )}
              </h3>
              <div className="pos-existing">
                <CampaignComposer
                  key={batch}
                  data={data}
                  locale={locale}
                  act={act}
                  sourceBatchId={batch}
                  initialTemplate={initialTemplate}
                  close={() => {
                    void refresh();
                    close();
                  }}
                />
              </div>
            </section>
          )}
        </>
      )}
      {!batch && (
        <div className="ci-empty">
          <FileSpreadsheet size={42} />
          <h3>{t(locale, "Empieza por tu archivo", "Start with your file")}</h3>
          <p>
            {t(
              locale,
              "Después podrás aprobar la verificación, revisar la plantilla y decidir cuándo enviar. Las respuestas se verán en Datos de campaña.",
              "Then approve verification, review the template and decide when to send. Replies appear in Campaign data.",
            )}
          </p>
        </div>
      )}
      {importing && (
        <ImportWizard
          data={data}
          locale={locale}
          act={act}
          refresh={refresh}
          close={() => setImporting(false)}
          onRegistered={setBatch}
          returnLabel={t(
            locale,
            "Continuar con esta campaña",
            "Continue with this campaign",
          )}
        />
      )}
    </section>
  );
}
