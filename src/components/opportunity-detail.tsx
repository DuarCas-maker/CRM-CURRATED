"use client";
import { useState, type FormEvent } from "react";
import { CaseMailHistory } from "./case-mail-history";
import { DocumentReview } from "./document-review";
import { MailComposer, MailSendStatus } from "./mail-composer";
import { MailInbox } from "./mail-inbox";
import { MailBody } from "./mail-bubble";
import {
  ArrowLeft,
  Phone,
  Mail,
  FileText,
  Plus,
  Check,
  Clock3,
  ChevronRight,
  Send,
  Link,
  Download,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import type { Workspace, Opportunity, Profile, Locale } from "@/lib/domain";
import {
  currency,
  dateLabel,
  stages,
  stageLabels,
  handoffErrors,
  canSeeArea,
  canSeeOpportunity,
  isCloserRole,
} from "@/lib/domain";
import type { Action } from "./crm";
import {
  Avatar,
  StageBadge,
  VerificationBadge,
  Modal,
  Field,
  SaveButton,
  Empty,
  t,
} from "./ui";
export function OpportunityDetail({
  opportunity: o,
  data,
  profile,
  locale,
  act,
  busy,
  back,
  refresh,
}: {
  opportunity: Opportunity;
  data: Workspace;
  profile: Profile;
  locale: Locale;
  act: Action;
  busy: boolean;
  back: () => void;
  refresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState("activity");
  const [modal, setModal] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState("");
  const [secureLink, setSecureLink] = useState("");
  const [reviewDocument, setReviewDocument] = useState<string | null>(null);
  const name = (id: string | null) =>
    data.profiles.find((p) => p.id === id)?.name ||
    t(locale, "Sin asignar", "Unassigned");
  const sellerAccess =
    !o.handed_off_at &&
    ["superadmin", "seller_admin", "seller"].includes(profile.role);
  const closerAccess = !!o.handed_off_at && isCloserRole(profile.role);
  const editable = sellerAccess || closerAccess;
  const docs = data.documents.filter((d) => d.opportunity_id === o.id);
  const analyses = data.analyses.filter((a) => a.opportunity_id === o.id);
  const activities = data.activities.filter(
    (a) => a.opportunity_id === o.id && canSeeArea(profile, o, a.area),
  );
  for (const message of data.messages) {
    const conversation = data.conversations.find(
      (c) => c.id === message.conversation_id && c.opportunity_id === o.id,
    );
    if (conversation && canSeeOpportunity(profile, o))
      activities.push({
        id: `email:${message.id}`,
        opportunity_id: o.id,
        actor_id: message.sender,
        type: "email",
        area: message.area || conversation.area,
        body: message.body,
        created_at: message.sent_at,
      });
  }
  const tasks = data.tasks.filter(
    (a) => a.opportunity_id === o.id && canSeeArea(profile, o, a.area),
  );
  const submissions = data.submissions.filter((s) => s.opportunity_id === o.id);
  const problems = handoffErrors(o, docs, data.analyses);
  async function submit(
    e: FormEvent<HTMLFormElement>,
    kind: string,
    extra: Record<string, unknown> = {},
  ) {
    e.preventDefault();
    setError("");
    try {
      await act(kind, {
        ...Object.fromEntries(new FormData(e.currentTarget)),
        opportunity_id: o.id,
        ...extra,
      });
      setModal(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function createLink() {
    setError("");
    if (data.demo) {
      setSecureLink(`${location.origin}/apply/demo`);
      return;
    }
    try {
      const res = await fetch("/api/application-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_id: o.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setSecureLink(body.url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <button className="back-link" onClick={back}>
        <ArrowLeft size={16} />
        {t(locale, "Volver a oportunidades", "Back to opportunities")}
      </button>
      <div className="case-heading">
        <div className="case-title">
          <span className="company-icon large tone-1">
            {o.company
              .split(" ")
              .slice(0, 2)
              .map((w) => w[0])
              .join("")}
          </span>
          <div>
            <div className="eyebrow">
              {o.product} · {o.industry || "Business"}
            </div>
            <h1>{o.company}</h1>
            <span>
              {o.contact} <span className="dot-separator">·</span> {o.email}
            </span>
          </div>
        </div>
        <div className="heading-actions">
          {canSeeOpportunity(profile, o) && data.gmail_history_enabled && (
            <button
              className="button primary"
              onClick={() => setComposing(true)}
            >
              <Mail size={16} />
              {t(locale, "Nuevo correo", "New email")}
            </button>
          )}
          <StageBadge stage={o.stage} locale={locale} />
        </div>
      </div>
      <div className="case-summary">
        <div>
          <span>{t(locale, "Responsable", "Owner")}</span>
          <strong className="person">
            <Avatar name={name(o.closer_id || o.seller_id)} small />
            {name(o.closer_id || o.seller_id)}
          </strong>
        </div>
        <div>
          <span>{t(locale, "Monto solicitado", "Requested amount")}</span>
          <strong>{currency(o.amount, locale)}</strong>
        </div>
        <div>
          <span>{t(locale, "Último contacto", "Last contact")}</span>
          <strong>{dateLabel(o.last_contact, locale, true)}</strong>
        </div>
        <div>
          <span>{t(locale, "Próxima acción", "Next action")}</span>
          <strong>
            {o.next_action || t(locale, "Por definir", "Not set")}
          </strong>
          <small>{dateLabel(o.next_action_at, locale, true)}</small>
        </div>
      </div>
      <div className="case-layout">
        <section className="panel case-main">
          <div className="case-tabs">
            {[
              ["activity", "Actividad", "Activity"],
              ["mail_history", "Correo e histórico", "Email and history"],
              ["documents", "Documentos", "Documents"],
              ["analysis", "Análisis manual", "Manual review"],
              ...(isCloserRole(profile.role) && o.handed_off_at
                ? [["lenders", "Lenders y ofertas", "Lenders & offers"]]
                : []),
            ].map(([id, es, en]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {t(locale, es, en)}
                {id === "documents" && (
                  <span>
                    {docs.filter((d) => d.status === "approved").length}/
                    {docs.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          {tab === "mail_history" && (
            <>
              <MailSendStatus data={data} locale={locale} caseId={o.id} />
              {data.gmail_history_enabled && !data.demo && (
                <MailInbox
                  data={data}
                  locale={locale}
                  act={act}
                  busy={busy}
                  openCase={() => {}}
                  opportunity={o}
                />
              )}
              <CaseMailHistory
                caseId={o.id}
                data={data}
                locale={locale}
                editable={editable}
                onChanged={refresh}
              />
            </>
          )}
          {tab === "activity" && (
            <div className="tab-content">
              <div className="activity-toolbar">
                <h2>{t(locale, "Historial del expediente", "Case history")}</h2>
                {editable && (
                  <div>
                    <button className="button" onClick={() => setModal("note")}>
                      <Plus size={15} />
                      {t(locale, "Nota", "Note")}
                    </button>
                    <button className="button" onClick={() => setModal("call")}>
                      <Phone size={15} />
                      {t(locale, "Llamada", "Call")}
                    </button>
                  </div>
                )}
              </div>
              <div className="timeline">
                {activities
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  .map((a) => (
                    <article key={a.id}>
                      <div className="timeline-icon">
                        {a.type === "call" ? (
                          <Phone size={15} />
                        ) : a.type === "email" ? (
                          <Mail size={15} />
                        ) : (
                          <FileText size={15} />
                        )}
                      </div>
                      <div>
                        <div className="timeline-meta">
                          <strong>
                            {a.type === "email" ? a.actor_id : name(a.actor_id)}
                          </strong>
                          <span>{dateLabel(a.created_at, locale, true)}</span>
                        </div>
                        <small>
                          {a.type} · {a.area}
                        </small>
                        {a.type === "email" ? (
                          <MailBody body={a.body} locale={locale} />
                        ) : (
                          <p>{a.body}</p>
                        )}
                      </div>
                    </article>
                  ))}
              </div>
              {!activities.length && (
                <Empty
                  title={t(
                    locale,
                    "El historial comienza aquí",
                    "The history starts here",
                  )}
                />
              )}
            </div>
          )}
          {tab === "documents" && (
            <div className="tab-content">
              <div className="activity-toolbar">
                <h2>
                  {t(locale, "Checklist documental", "Document checklist")}
                </h2>
                {editable && (
                  <div>
                    <button
                      className="button"
                      onClick={() => setModal("add-document")}
                    >
                      {t(
                        locale,
                        "Agregar requisito o informe",
                        "Add requirement or report",
                      )}
                    </button>
                    <button
                      className="button"
                      onClick={() => setModal("upload")}
                    >
                      <Plus size={16} />
                      {t(locale, "Incorporar archivo", "Add document")}
                    </button>
                  </div>
                )}
              </div>
              <p className="muted">
                {t(
                  locale,
                  "Recibir un archivo no equivale a aprobarlo. Revisa su contenido y período.",
                  "Receiving a file does not approve it. Review its contents and period.",
                )}
              </p>
              <p role="status">
                {
                  docs.filter(
                    (d) => d.required !== false && d.status === "approved",
                  ).length
                }
                /{docs.filter((d) => d.required !== false).length}{" "}
                {t(
                  locale,
                  "documentos obligatorios aprobados",
                  "required documents approved",
                )}
              </p>
              {docs.map((d) => (
                <div className="document-row" key={d.id}>
                  <span
                    className={`document-icon ${d.status === "approved" ? "approved" : ""}`}
                  >
                    {d.status === "approved" ? (
                      <ShieldCheck size={20} />
                    ) : (
                      <FileText size={20} />
                    )}
                  </span>
                  <div>
                    <strong>{d.name}</strong>
                    <small>
                      {d.period} · {d.source} ·{" "}
                      {dateLabel(d.created_at, locale)}
                    </small>
                    {d.review_notes && <small>{d.review_notes}</small>}
                    {d.reviewed_at && (
                      <small>
                        {t(locale, "Revisado por", "Reviewed by")}{" "}
                        {name(d.reviewed_by || null)} ·{" "}
                        {dateLabel(d.reviewed_at, locale, true)}
                      </small>
                    )}
                  </div>
                  <span
                    className={`badge ${d.status === "approved" ? "stage-funded" : "stage-documents_pending"}`}
                  >
                    {t(
                      locale,
                      {
                        pending: "Pendiente",
                        received: "Recibido",
                        approved: "Aprobado",
                        correction: "Corregir",
                      }[d.status],
                      d.status,
                    )}
                  </span>
                  {d.storage_path && !data.demo && (
                    <a
                      className="icon-button"
                      href={`/api/documents/${d.id}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open document"
                    >
                      <Download size={17} />
                    </a>
                  )}
                  {editable && d.status !== "pending" && (
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => setReviewDocument(d.id)}
                    >
                      {t(locale, "Revisar documento", "Review document")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {tab === "analysis" && (
            <div className="tab-content">
              <div className="activity-toolbar">
                <h2>
                  {t(
                    locale,
                    "Análisis registrado por el equipo",
                    "Team review",
                  )}
                </h2>
                {sellerAccess && (
                  <button
                    className="button"
                    onClick={() => setModal("analysis")}
                  >
                    <Plus size={15} />
                    {t(locale, "Registrar análisis", "Add review")}
                  </button>
                )}
              </div>
              {analyses.map((a) => (
                <article className="analysis-card" key={a.id}>
                  <div className="person">
                    <Avatar name={name(a.reviewer_id)} small />
                    <strong>{name(a.reviewer_id)}</strong>
                    <small>{dateLabel(a.reviewed_at, locale)}</small>
                  </div>
                  <h3>{t(locale, "Resumen", "Summary")}</h3>
                  <p>{a.summary}</p>
                  <h3>{t(locale, "Conclusión", "Conclusion")}</h3>
                  <p>{a.conclusion}</p>
                  <h3>{t(locale, "Observaciones", "Observations")}</h3>
                  <p>{a.observations || "—"}</p>
                  <h3>
                    {t(
                      locale,
                      "Lenders recomendados y motivos",
                      "Recommended lenders and reasons",
                    )}
                  </h3>
                  <p>{a.recommendations}</p>
                </article>
              ))}
              {!analyses.length && (
                <Empty
                  title={t(locale, "Análisis pendiente", "Review pending")}
                  body={t(
                    locale,
                    "Registra la revisión realizada fuera de la aplicación.",
                    "Record the analysis performed outside the application.",
                  )}
                />
              )}
            </div>
          )}
          {tab === "lenders" && (
            <div className="tab-content">
              <div className="activity-toolbar">
                <h2>
                  {t(
                    locale,
                    "Solicitudes independientes",
                    "Independent submissions",
                  )}
                </h2>
                {closerAccess && (
                  <button
                    className="button"
                    onClick={() => setModal("submission")}
                  >
                    <Plus size={15} />
                    {t(locale, "Registrar solicitud", "Record submission")}
                  </button>
                )}
              </div>
              {submissions.map((s) => (
                <article className="submission-card" key={s.id}>
                  <div className="section-heading">
                    <h3>
                      {data.lenders.find((l) => l.id === s.lender_id)?.name}
                    </h3>
                    <span className="badge">{s.status}</span>
                  </div>
                  <p>
                    {s.channel} · {dateLabel(s.submitted_at, locale)} ·{" "}
                    {s.external_reference}
                  </p>
                  <p>
                    <strong>{t(locale, "Próximo paso", "Next step")}: </strong>
                    {s.next_action}
                  </p>
                  {data.offers
                    .filter((f) => f.submission_id === s.id)
                    .map((f) => (
                      <div className="offer-card" key={f.id}>
                        <strong>{currency(f.amount, locale)}</strong>
                        <span>{f.product}</span>
                        <dl>
                          <dt>{t(locale, "Plazo", "Term")}</dt>
                          <dd>{f.term}</dd>
                          <dt>{t(locale, "Costo", "Cost")}</dt>
                          <dd>{f.cost}</dd>
                          <dt>{t(locale, "Pagos", "Payment frequency")}</dt>
                          <dd>{f.frequency}</dd>
                          <dt>{t(locale, "Cargos", "Fees")}</dt>
                          <dd>{f.fees}</dd>
                          <dt>{t(locale, "Vigencia", "Valid until")}</dt>
                          <dd>{dateLabel(f.expires_at, locale)}</dd>
                        </dl>
                      </div>
                    ))}
                  {closerAccess && (
                    <div className="card-actions">
                      <button
                        className="button"
                        onClick={() => setModal(`offer:${s.id}`)}
                      >
                        <Plus size={15} />
                        {t(locale, "Registrar oferta", "Record offer")}
                      </button>
                      <button
                        className="button"
                        onClick={() => setModal(`submission-update:${s.id}`)}
                      >
                        {t(locale, "Actualizar", "Update")}
                      </button>
                      {s.channel === "email" && (
                        <button
                          className="button"
                          onClick={() => setModal(`lender-email:${s.id}`)}
                        >
                          <Send size={14} />
                          {t(locale, "Preparar correo", "Prepare email")}
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))}
              {!submissions.length && (
                <Empty
                  title={t(
                    locale,
                    "Sin solicitudes a lenders",
                    "No lender submissions",
                  )}
                />
              )}
            </div>
          )}
        </section>
        <aside className="case-side">
          <section className="panel side-panel">
            <h2>{t(locale, "Última gestión", "Latest update")}</h2>
            <p>
              {[...activities].sort((a, b) =>
                b.created_at.localeCompare(a.created_at),
              )[0]?.body ||
                o.summary ||
                t(locale, "Sin gestión registrada.", "No activity recorded.")}
            </p>
            <VerificationBadge locale={locale} status={o.verification} />
          </section>
          <section className="panel side-panel">
            <h2>{t(locale, "Próximos pasos", "Next steps")}</h2>
            {tasks.map((task) => (
              <div className="mini-task" key={task.id}>
                <button
                  className="task-check"
                  disabled={!editable || task.status === "done"}
                  onClick={() =>
                    act("complete_task", { id: task.id }).catch(() => {})
                  }
                  aria-label="Complete task"
                >
                  {task.status === "done" && <Check size={14} />}
                </button>
                <div>
                  <strong>{task.title}</strong>
                  <small>{dateLabel(task.due_at, locale, true)}</small>
                </div>
              </div>
            ))}
            {editable && (
              <button className="text-button" onClick={() => setModal("next")}>
                <Plus size={15} />
                {t(locale, "Definir próxima acción", "Set next action")}
              </button>
            )}
          </section>
          <section className="panel side-panel">
            <h2>{t(locale, "Gestión del caso", "Case management")}</h2>
            {((sellerAccess && profile.role === "seller_admin") ||
              profile.role === "superadmin") && (
              <button
                className="button full"
                onClick={() => setModal("assign-seller")}
              >
                {t(locale, "Reasignar seller", "Reassign seller")}
              </button>
            )}
            {editable && (
              <button
                className="button full"
                onClick={() => setModal("request-documents")}
              >
                <Mail size={15} />
                {t(locale, "Pedir documentación", "Request documents")}
              </button>
            )}
            {editable && (
              <button className="button full" onClick={() => setModal("stage")}>
                {t(locale, "Actualizar estado", "Update stage")}
              </button>
            )}
            {sellerAccess && (
              <>
                <button
                  className="button full"
                  onClick={() => {
                    setSecureLink("");
                    setModal("link");
                  }}
                >
                  <Link size={15} />
                  {t(locale, "Enlace de aplicación", "Application link")}
                </button>
                <button
                  className="button primary full"
                  onClick={() => setModal("handoff")}
                >
                  <Send size={15} />
                  {t(locale, "Traspasar a closer", "Hand off to closer")}
                </button>
              </>
            )}
            {o.handed_off_at &&
              ["superadmin", "closer_admin"].includes(profile.role) && (
                <button
                  className="button primary full"
                  onClick={() => setModal("assign")}
                >
                  {t(locale, "Asignar closer", "Assign closer")}
                </button>
              )}
            {closerAccess &&
              ["accepted", "funding_pending"].includes(o.stage) && (
                <button
                  className="button primary full"
                  onClick={() => setModal("fund")}
                >
                  {t(locale, "Confirmar desembolso", "Confirm funding")}
                </button>
              )}
            {o.handed_off_at && !isCloserRole(profile.role) && (
              <p className="muted">
                {t(
                  locale,
                  "Expediente transferido. Puedes consultar tu fase y el avance general.",
                  "Case handed off. You can review your phase and overall progress.",
                )}
              </p>
            )}
            {o.stage === "funded" && (
              <div className="funded-result">
                <CircleCheckIcon />
                <strong>{currency(o.funded_amount || 0, locale)}</strong>
                <span>{dateLabel(o.funded_at, locale)}</span>
              </div>
            )}
          </section>
        </aside>
      </div>
      {composing && (
        <MailComposer
          data={data}
          locale={locale}
          act={act}
          busy={busy}
          close={() => setComposing(false)}
          opportunity={o}
        />
      )}
      {reviewDocument && (
        <DocumentReview
          selection={{ source: "document", id: reviewDocument }}
          data={{ ...data, profile }}
          locale={locale}
          act={act}
          close={() => setReviewDocument(null)}
        />
      )}
      {modal && (
        <Modal
          title={t(
            locale,
            (
              {
                note: "Agregar nota",
                call: "Registrar llamada",
                analysis: "Análisis manual",
                stage: "Cambiar estado",
                next: "Próxima acción",
                handoff: "Traspaso de expediente",
                assign: "Asignar closer",
                submission: "Solicitud a lender",
                fund: "Confirmar desembolso",
                link: "Enlace seguro",
                upload: "Incorporar documento",
                "request-documents": "Solicitar documentación por correo",
                "add-document": "Agregar documento al checklist",
                "assign-seller": "Reasignar seller",
              } as Record<string, string>
            )[modal] || "Gestión del lender",
            (
              {
                note: "Add note",
                call: "Log call",
                analysis: "Manual review",
                stage: "Change stage",
                next: "Next action",
                handoff: "Case handoff",
                assign: "Assign closer",
                submission: "Lender submission",
                fund: "Confirm funding",
                link: "Secure link",
                upload: "Add document",
                "request-documents": "Request documents by email",
                "add-document": "Add checklist document",
                "assign-seller": "Reassign seller",
              } as Record<string, string>
            )[modal] || "Lender management",
          )}
          close={() => {
            setModal(null);
            setError("");
          }}
        >
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {modal === "assign-seller" && (
            <form onSubmit={(e) => submit(e, "assign_seller")}>
              <Field
                name="seller_id"
                label={t(
                  locale,
                  "Nuevo responsable seller",
                  "New seller owner",
                )}
                value={o.seller_id}
              >
                {data.profiles
                  .filter((p) =>
                    ["superadmin", "seller_admin", "seller"].includes(p.role),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Field>
              <div className="modal-footer">
                <SaveButton locale={locale} busy={busy} />
              </div>
            </form>
          )}
          {modal === "add-document" && (
            <form onSubmit={(e) => submit(e, "add_document")}>
              <Field
                name="name"
                label={t(locale, "Nombre del documento", "Document name")}
                required
              />
              <Field name="kind" label={t(locale, "Tipo", "Type")}>
                <option value="additional">
                  {t(locale, "Documento adicional", "Additional document")}
                </option>
                <option value="analysis_report">
                  {t(locale, "Informe de análisis", "Analysis report")}
                </option>
              </Field>
              <Field
                name="period"
                label={t(locale, "Período o referencia", "Period or reference")}
              />
              <Field
                name="required"
                label={t(
                  locale,
                  "Requerido para traspaso",
                  "Required for handoff",
                )}
              >
                <option value="true">{t(locale, "Sí", "Yes")}</option>
                <option value="false">
                  {t(locale, "Opcional", "Optional")}
                </option>
              </Field>
              <p className="muted">
                {t(
                  locale,
                  "Después de guardar, usa Incorporar archivo para adjuntar el documento.",
                  "After saving, use Add document to upload the file.",
                )}
              </p>
              <div className="modal-footer">
                <SaveButton locale={locale} busy={busy} />
              </div>
            </form>
          )}
          {modal === "request-documents" && (
            <form onSubmit={(e) => submit(e, "request_documents")}>
              <Field
                name="account_id"
                label={t(locale, "Cuenta remitente", "Sender account")}
              >
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                  </option>
                ))}
              </Field>
              <Field
                name="body"
                label={t(locale, "Mensaje al cliente", "Message to client")}
                type="textarea"
                value={`Hi ${o.contact},\n\nPlease upload the outstanding documents for your financing request using the secure link below.\n\nThank you,\nCurated Financial`}
                required
              />
              <p className="muted">
                {t(
                  locale,
                  "Se añadirá un enlace seguro de carga para este expediente.",
                  "A secure upload link for this case will be included.",
                )}
              </p>
              <div className="modal-footer">
                <SaveButton
                  locale={locale}
                  busy={busy}
                  label={t(locale, "Confirmar y enviar", "Confirm and send")}
                />
              </div>
            </form>
          )}
          {["note", "call"].includes(modal) && (
            <form onSubmit={(e) => submit(e, "activity", { type: modal })}>
              <Field
                label={
                  modal === "call"
                    ? t(locale, "Resultado de la llamada", "Call outcome")
                    : t(locale, "Nota", "Note")
                }
                name="body"
                type="textarea"
                required
              />
              {modal === "call" && (
                <>
                  <Field
                    label={t(locale, "Compromiso siguiente", "Next commitment")}
                    name="next_action"
                    required
                  />
                  <Field
                    name="next_action_at"
                    label={t(locale, "Fecha", "Date")}
                    type="datetime-local"
                    required
                  />
                </>
              )}
              <div className="modal-footer">
                <SaveButton busy={busy} locale={locale} />
              </div>
            </form>
          )}
          {modal === "analysis" && (
            <form onSubmit={(e) => submit(e, "analysis")}>
              <Field
                name="summary"
                label={t(locale, "Resumen", "Summary")}
                type="textarea"
                required
              />
              <Field
                name="conclusion"
                label={t(locale, "Conclusión", "Conclusion")}
                type="textarea"
                required
              />
              <Field
                name="observations"
                label={t(
                  locale,
                  "Observaciones / información por revisar",
                  "Observations / information to review",
                )}
                type="textarea"
              />
              <Field
                name="recommendations"
                label={t(
                  locale,
                  "Lenders recomendados y motivos",
                  "Recommended lenders and reasons",
                )}
                type="textarea"
                required
              />
              <div className="modal-footer">
                <SaveButton busy={busy} locale={locale} />
              </div>
            </form>
          )}
          {modal === "stage" && (
            <form onSubmit={(e) => submit(e, "transition")}>
              <Field
                name="stage"
                label={t(locale, "Estado", "Stage")}
                value={o.stage}
              >
                {stages
                  .filter(
                    (s) =>
                      !["funded", "ready_for_closer", "unassigned"].includes(
                        s,
                      ) &&
                      (o.handed_off_at
                        ? [
                            "lenders",
                            "offers",
                            "negotiation",
                            "accepted",
                            "funding_pending",
                            "lost",
                            "paused",
                          ].includes(s)
                        : [
                            "new",
                            "contacting",
                            "replied",
                            "application_pending",
                            "documents_pending",
                            "analysis",
                            "lost",
                            "paused",
                          ].includes(s)),
                  )
                  .map((s) => (
                    <option key={s} value={s}>
                      {stageLabels[locale][s]}
                    </option>
                  ))}
              </Field>
              <Field
                name="reason"
                label={t(locale, "Motivo del cambio", "Reason for change")}
                type="textarea"
                required
              />
              <div className="modal-footer">
                <SaveButton busy={busy} locale={locale} />
              </div>
            </form>
          )}
          {modal === "next" && (
            <form onSubmit={(e) => submit(e, "next_action")}>
              <Field
                name="next_action"
                label={t(locale, "Acción", "Action")}
                value={o.next_action}
                required
              />
              <Field
                name="next_action_at"
                label={t(locale, "Vencimiento", "Due date")}
                type="datetime-local"
                required
              />
              <div className="modal-footer">
                <SaveButton busy={busy} locale={locale} />
              </div>
            </form>
          )}
          {modal === "handoff" && (
            <form onSubmit={(e) => submit(e, "handoff")}>
              <p>
                {t(
                  locale,
                  "El admin de closers recibirá el expediente y asignará su responsable.",
                  "The closer admin will receive the case and assign its owner.",
                )}
              </p>
              {[
                [
                  "application",
                  t(
                    locale,
                    "Aplicación completa y firmada",
                    "Complete and signed application",
                  ),
                ],
                [
                  "documents",
                  t(
                    locale,
                    "Documentación completa y aprobada",
                    "Complete and approved documents",
                  ),
                ],
                [
                  "analysis",
                  t(
                    locale,
                    "Análisis y recomendaciones registrados",
                    "Analysis and recommendations recorded",
                  ),
                ],
              ].map(([id, label]) => (
                <div className="handoff-item" key={id}>
                  {problems.includes(id) ? (
                    <AlertCircle size={20} className="overdue" />
                  ) : (
                    <ShieldCheck size={20} className="green-text" />
                  )}
                  <span>{label}</span>
                </div>
              ))}
              <div className="modal-footer">
                <button
                  className="button primary"
                  disabled={busy || problems.length > 0}
                >
                  {t(locale, "Confirmar traspaso", "Confirm handoff")}
                </button>
              </div>
            </form>
          )}
          {modal === "assign" && (
            <form onSubmit={(e) => submit(e, "assign_closer")}>
              <Field name="closer_id" label="Closer" required>
                {data.profiles
                  .filter((p) =>
                    ["closer", "closer_admin", "superadmin"].includes(p.role),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Field>
              <div className="modal-footer">
                <SaveButton busy={busy} locale={locale} />
              </div>
            </form>
          )}
          {modal === "submission" && (
            <form onSubmit={(e) => submit(e, "submission")}>
              <Field name="lender_id" label="Lender" required>
                {data.lenders.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Field>
              <Field name="channel" label={t(locale, "Canal", "Channel")}>
                <option value="portal">Portal</option>
                <option value="email">Email</option>
              </Field>
              <Field
                name="external_reference"
                label={t(
                  locale,
                  "Referencia / documentos presentados",
                  "Reference / submitted documents",
                )}
              />
              <Field
                name="next_action"
                label={t(locale, "Próxima acción", "Next action")}
                required
              />
              <Field
                name="next_action_at"
                label={t(locale, "Fecha", "Date")}
                type="datetime-local"
                required
              />
              <div className="modal-footer">
                <SaveButton busy={busy} locale={locale} />
              </div>
            </form>
          )}
          {modal.startsWith("submission-update:") && (
            <form
              onSubmit={(e) =>
                submit(e, "update_submission", { id: modal.split(":")[1] })
              }
            >
              <Field name="status" label={t(locale, "Estado", "Status")}>
                {[
                  "submitted",
                  "reviewing",
                  "requirements",
                  "offer",
                  "rejected",
                  "withdrawn",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Field>
              <Field
                name="next_action"
                label={t(
                  locale,
                  "Próxima acción / motivo",
                  "Next action / reason",
                )}
                required
              />
              <Field
                name="next_action_at"
                label={t(locale, "Fecha", "Date")}
                type="datetime-local"
                required
              />
              <div className="modal-footer">
                <SaveButton busy={busy} locale={locale} />
              </div>
            </form>
          )}
          {modal.startsWith("offer:") && (
            <form
              onSubmit={(e) =>
                submit(e, "offer", { submission_id: modal.split(":")[1] })
              }
            >
              <Field name="product" label={t(locale, "Producto", "Product")}>
                <option>Business loan</option>
                <option>MCA</option>
                <option>Line of credit</option>
                <option>Equipment financing</option>
              </Field>
              <Field
                name="amount"
                label={t(locale, "Monto (USD)", "Amount (USD)")}
                type="number"
                min={1}
                required
              />
              <Field name="term" label={t(locale, "Plazo", "Term")} />
              <Field
                name="cost"
                label={t(
                  locale,
                  "Condiciones de costo (APR, factor u otras)",
                  "Cost terms (APR, factor or other)",
                )}
              />
              <Field
                name="frequency"
                label={t(locale, "Frecuencia de pago", "Payment frequency")}
              />
              <Field
                name="fees"
                label={t(locale, "Cargos o descuentos", "Fees or discounts")}
              />
              <Field
                name="expires_at"
                label={t(locale, "Vigencia", "Valid until")}
                type="date"
              />
              <div className="modal-footer">
                <SaveButton busy={busy} locale={locale} />
              </div>
            </form>
          )}
          {modal === "fund" && (
            <form onSubmit={(e) => submit(e, "fund")}>
              <p>
                {t(
                  locale,
                  "Confirma únicamente cuando el lender haya realizado el desembolso.",
                  "Confirm only after the lender has disbursed the funds.",
                )}
              </p>
              <Field name="lender_id" label="Lender">
                {data.lenders
                  .filter((l) => submissions.some((s) => s.lender_id === l.id))
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </Field>
              <Field
                name="amount"
                label={t(
                  locale,
                  "Monto efectivo (USD)",
                  "Actual funded amount (USD)",
                )}
                type="number"
                min={1}
                required
              />
              <Field
                name="funded_at"
                label={t(locale, "Fecha del desembolso", "Funding date")}
                type="date"
                required
              />
              <div className="modal-footer">
                <SaveButton
                  busy={busy}
                  locale={locale}
                  label={t(locale, "Confirmar desembolso", "Confirm funding")}
                />
              </div>
            </form>
          )}
          {modal === "link" && (
            <div>
              <p>
                {t(
                  locale,
                  "El enlace caduca en 14 días y vincula la solicitud a este expediente. No incluye datos personales.",
                  "The link expires in 14 days and links the application to this case. It contains no personal information.",
                )}
              </p>
              <button className="button primary" onClick={createLink}>
                {t(locale, "Generar enlace seguro", "Generate secure link")}
              </button>
              {secureLink && (
                <div className="secure-link">
                  <a href={secureLink} target="_blank" rel="noreferrer">
                    {secureLink}
                  </a>
                  <button
                    className="button"
                    onClick={() => navigator.clipboard.writeText(secureLink)}
                  >
                    {t(locale, "Copiar", "Copy")}
                  </button>
                </div>
              )}
            </div>
          )}
          {modal === "upload" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                const form = new FormData(e.currentTarget);
                form.set("opportunity_id", o.id);
                try {
                  if (data.demo)
                    await act("upload_demo", {
                      opportunity_id: o.id,
                      name: (form.get("file") as File).name,
                      document_id: form.get("document_id"),
                    });
                  else {
                    const res = await fetch("/api/documents", {
                      method: "POST",
                      body: form,
                    });
                    const result = await res.json();
                    if (!res.ok) throw new Error(result.error);
                    location.reload();
                  }
                  setModal(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Field
                name="document_id"
                label={t(
                  locale,
                  "Documento del checklist",
                  "Checklist document",
                )}
              >
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Field>
              <label className="field">
                <span>PDF / JPG / PNG · 20 MB</span>
                <input
                  name="file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  required
                />
              </label>
              <div className="modal-footer">
                <SaveButton busy={busy} locale={locale} />
              </div>
            </form>
          )}
          {modal.startsWith("lender-email:") && (
            <form
              onSubmit={(e) =>
                submit(e, "lender_email", {
                  submission_id: modal.split(":")[1],
                })
              }
            >
              <Field
                name="account_id"
                label={t(locale, "Cuenta remitente", "Sender account")}
              >
                {data.accounts
                  .filter((a) => a.status === "connected" || data.demo)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email}
                    </option>
                  ))}
              </Field>
              <Field
                name="subject"
                label="Subject"
                value={`Financing request · ${o.company}`}
                required
              />
              <Field
                name="body"
                label={t(locale, "Mensaje revisado", "Reviewed message")}
                type="textarea"
                required
              />
              <p className="muted">
                {t(
                  locale,
                  "Se adjuntarán los documentos aprobados del expediente. Revisa el destinatario y el contenido antes de enviar.",
                  "Approved case documents will be attached. Review the recipient and content before sending.",
                )}
              </p>
              <div className="modal-footer">
                <SaveButton
                  busy={busy}
                  locale={locale}
                  label={t(locale, "Confirmar y enviar", "Confirm and send")}
                />
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
function CircleCheckIcon() {
  return <ShieldCheck size={26} />;
}
