"use client";
import { useState, type FormEvent } from "react";
import { CaseMailHistory } from "./case-mail-history";
import { DocumentReview } from "./document-review";
import { BankDocumentManagement } from "./bank-document-management";
import { DocumentUpload } from "./document-upload";
import { DocumentCreate } from "./document-create";
import { CompanyApplicationForm } from "./company-application";
import { documentLabel, documentProgress } from "@/lib/document-labels";
import { hasDocumentFile } from "@/lib/document-intake";
import { UnderwritingWorkspace } from "./underwriting-workspace";
import { MailComposer, MailSendStatus } from "./mail-composer";
import { MailInbox } from "./mail-inbox";
import { MailBody } from "./mail-bubble";
import { MailAttachments } from "./mail-attachments";
import type { DocumentSelection } from "@/lib/document-review";
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
  initialTab = "activity",
  embedded = false,
}: {
  opportunity: Opportunity;
  data: Workspace;
  profile: Profile;
  locale: Locale;
  act: Action;
  busy: boolean;
  back: () => void;
  refresh: () => Promise<void>;
  initialTab?: "activity" | "documents" | "analysis" | "lenders";
  embedded?: boolean;
}) {
  const [tab, setTab] = useState<string>(initialTab);
  const [modal, setModal] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState("");
  const [secureLink, setSecureLink] = useState("");
  const [selectedStatements, setSelectedStatements] = useState<string[]>([]);
  const [movingStatements, setMovingStatements] = useState<string[] | null>(
    null,
  );
  const [reviewDocument, setReviewDocument] = useState<string | null>(null);
  const [reviewAttachment, setReviewAttachment] =
    useState<DocumentSelection | null>(null);
  const name = (id: string | null) =>
    data.profiles.find((p) => p.id === id)?.name ||
    t(locale, "Sin asignar", "Unassigned");
  const sellerAccess =
    !o.handed_off_at &&
    ["superadmin", "seller_admin", "seller"].includes(profile.role);
  const closerAccess = !!o.handed_off_at && isCloserRole(profile.role);
  const editable = sellerAccess || closerAccess;
  const docs = data.documents.filter((d) => d.opportunity_id === o.id);
  const documentStatus = documentProgress(docs);
  const visibleDocs = docs.filter(hasDocumentFile);
  const documentGroups = [
    ...new Set(
      visibleDocs.map((d) =>
        d.kind === "bank_statement"
          ? d.bank_name ||
            t(locale, "Banco por identificar", "Bank to identify")
          : t(
              locale,
              "Aplicación y otros documentos",
              "Application and other documents",
            ),
      ),
    ),
  ];
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
      {!embedded && (
        <button className="back-link" onClick={back}>
          <ArrowLeft size={16} />
          {t(locale, "Volver a oportunidades", "Back to opportunities")}
        </button>
      )}
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
          {!embedded && (
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
                  {id === "documents" && <span>{visibleDocs.length}</span>}
                </button>
              ))}
            </div>
          )}
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
                          <>
                            <MailBody body={a.body} locale={locale} />
                            {a.id.startsWith("email:") && (
                              <MailAttachments
                                data={data}
                                locale={locale}
                                files={(data.mail_files || []).filter(
                                  (f) => f.message_id === a.id.slice(6),
                                )}
                                legacyAttachments={(
                                  data.attachments || []
                                ).filter((f) => f.message_id === a.id.slice(6))}
                                onFileReview={(f) =>
                                  setReviewAttachment({
                                    source: "saved",
                                    id: f.id,
                                  })
                                }
                                onAttachment={(f) =>
                                  setReviewAttachment({
                                    source: "legacy",
                                    id: f.id,
                                  })
                                }
                              />
                            )}
                          </>
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
                      onClick={() => setModal("company-application")}
                    >
                      {t(
                        locale,
                        "Completar aplicación / PDF",
                        "Complete application / PDF",
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
                  "Aprueba la aplicación y al menos cuatro extractos en total. Puedes guardar extractos de todos los bancos y documentos adicionales.",
                  "Approve the application and at least four statements in total. You can save statements from every bank and additional documents.",
                )}
              </p>
              <div className="document-progress" role="status">
                <p>
                  <strong>
                    {Math.min(4, documentStatus.receivedStatements)}/4{" "}
                    {t(locale, "extractos recibidos", "statements received")}
                  </strong>{" "}
                  · {Math.min(4, documentStatus.statements)}/4{" "}
                  {t(locale, "aprobados", "approved")}
                  {documentStatus.receivedStatements > 4
                    ? ` · ${documentStatus.receivedStatements} ${t(locale, "archivos en total", "files in total")}`
                    : ""}
                </p>
                <p>
                  {documentStatus.applicationReceived
                    ? t(locale, "Aplicación recibida", "Application received")
                    : t(
                        locale,
                        "Falta recibir la aplicación",
                        "Application not received",
                      )}{" "}
                  ·{" "}
                  {documentStatus.applicationApproved
                    ? t(locale, "Aprobada", "Approved")
                    : t(locale, "Pendiente de aprobación", "Pending approval")}
                </p>
                {documentStatus.missingStatements > 0 && (
                  <p>
                    {t(locale, "Faltan", "Missing")}{" "}
                    {documentStatus.missingStatements}{" "}
                    {t(
                      locale,
                      "extractos para completar el mínimo. Pueden ser del mismo banco o de bancos diferentes.",
                      "statements to meet the minimum. They may belong to the same or different banks.",
                    )}
                  </p>
                )}
              </div>
              {!visibleDocs.length && (
                <>
                  <p>
                    {t(
                      locale,
                      "Aún no hay archivos guardados. Usa Incorporar archivo o Incorporar y revisar junto a un adjunto de Correo e histórico. El sistema asignará el siguiente extracto disponible.",
                      "No files have been saved. Use Add document or Add and review beside a Mail and history attachment. The next available statement will be assigned.",
                    )}
                  </p>
                </>
              )}
              {editable &&
                visibleDocs.some((d) => d.kind === "bank_statement") && (
                  <div className="bank-management-toolbar">
                    <label>
                      <input
                        type="checkbox"
                        checked={visibleDocs
                          .filter((d) => d.kind === "bank_statement")
                          .every((d) => selectedStatements.includes(d.id))}
                        onChange={(e) =>
                          setSelectedStatements(
                            e.target.checked
                              ? visibleDocs
                                  .filter((d) => d.kind === "bank_statement")
                                  .map((d) => d.id)
                              : [],
                          )
                        }
                      />{" "}
                      {t(
                        locale,
                        "Seleccionar todos los extractos",
                        "Select all statements",
                      )}
                    </label>
                    <button
                      className="button"
                      disabled={busy || !selectedStatements.length}
                      onClick={() => setMovingStatements(selectedStatements)}
                    >
                      {t(
                        locale,
                        "Cambiar banco / ordenar seleccionados",
                        "Change bank / order selected",
                      )}{" "}
                      ({selectedStatements.length})
                    </button>
                  </div>
                )}
              {documentGroups.map((group) => (
                <section key={group} className="document-bank-group">
                  <h3>{group}</h3>
                  {visibleDocs
                    .filter(
                      (d) =>
                        (d.kind === "bank_statement"
                          ? d.bank_name ||
                            t(
                              locale,
                              "Banco por identificar",
                              "Bank to identify",
                            )
                          : t(
                              locale,
                              "Aplicación y otros documentos",
                              "Application and other documents",
                            )) === group,
                    )
                    .sort(
                      (a, b) =>
                        (a.statement_number || 0) - (b.statement_number || 0),
                    )
                    .map((d) => (
                      <div className="document-row" key={d.id}>
                        {editable && d.kind === "bank_statement" && (
                          <input
                            type="checkbox"
                            aria-label={
                              t(locale, "Seleccionar", "Select") +
                              " " +
                              group +
                              " " +
                              documentLabel(d, locale)
                            }
                            checked={selectedStatements.includes(d.id)}
                            disabled={busy}
                            onChange={(e) =>
                              setSelectedStatements((ids) =>
                                e.target.checked
                                  ? [...ids, d.id]
                                  : ids.filter((id) => id !== d.id),
                              )
                            }
                          />
                        )}
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
                          <strong>{documentLabel(d, locale)}</strong>
                          <small>
                            {d.source} · {dateLabel(d.created_at, locale)}
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
                        {editable && d.kind === "bank_statement" && (
                          <button
                            type="button"
                            className="button"
                            disabled={busy}
                            onClick={() => setMovingStatements([d.id])}
                          >
                            {t(
                              locale,
                              "Cambiar banco / orden",
                              "Change bank / order",
                            )}
                          </button>
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
                </section>
              ))}
            </div>
          )}
          {tab === "analysis" && (
            <div className="tab-content">
              <UnderwritingWorkspace
                data={data}
                opportunity={o}
                locale={locale}
                editable={editable}
                refresh={refresh}
                openDocuments={() => setTab("documents")}
              />
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
                  {a.is_current === false && (
                    <p className="error-banner">
                      {t(
                        locale,
                        "Análisis anterior: los documentos cambiaron. Requiere un nuevo análisis.",
                        "Previous analysis: documents changed. A new analysis is required.",
                      )}
                    </p>
                  )}
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
      {movingStatements && (
        <BankDocumentManagement
          documents={docs}
          selected={movingStatements}
          locale={locale}
          act={act}
          close={() => {
            setMovingStatements(null);
            setSelectedStatements([]);
          }}
        />
      )}
      {reviewAttachment && (
        <DocumentReview
          selection={reviewAttachment}
          data={data}
          locale={locale}
          act={act}
          close={() => {
            setReviewAttachment(null);
            void refresh();
          }}
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
      {modal === "company-application" && (
        <CompanyApplicationForm
          opportunity={o}
          workspace={data}
          locale={locale}
          refresh={refresh}
          close={() => setModal(null)}
        />
      )}
      {modal && modal !== "company-application" && (
        <Modal
          wide={modal === "upload"}
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
            <DocumentCreate
              opportunityId={o.id}
              documents={docs}
              locale={locale}
              act={act}
              onCreated={() => setModal(null)}
            />
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
            <DocumentUpload
              opportunityId={o.id}
              documents={docs}
              locale={locale}
              demo={!!data.demo}
              act={act}
              refresh={refresh}
              close={() => setModal(null)}
            />
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
