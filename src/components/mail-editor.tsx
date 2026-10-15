"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Locale, Opportunity, Workspace } from "@/lib/domain";
import { canSeeOpportunity } from "@/lib/domain";
import {
  defaultReplyAccount,
  mailCopies,
  type MailDraft,
} from "@/lib/mail-manager";
import type { Action } from "./crm";
import { Modal, SaveButton, t } from "./ui";

export function MailEditor({
  data,
  locale,
  act,
  busy,
  close,
  opportunity,
  start = {},
  inline = false,
  replyContext,
  onQueued,
  compact = false,
  focusToken = 0,
  onAccountChange,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  busy: boolean;
  close: () => void;
  opportunity?: Opportunity;
  start?: MailDraft;
  inline?: boolean;
  replyContext?: { sender: string; body: string };
  onQueued?: (mail: MailDraft, id?: string) => void;
  compact?: boolean;
  focusToken?: number;
  onAccountChange?: (id: string) => void;
}) {
  const choices = data.opportunities.filter((o) =>
    canSeeOpportunity(data.profile, o),
  );
  const [caseId, setCaseId] = useState(
    opportunity?.id || start.opportunity_id || choices[0]?.id || "",
  );
  const accounts = data.accounts.filter(
    (a) =>
      (a.status === "connected" || (data.demo && a.status === "demo")) &&
      data.sender_account_ids?.includes(a.id),
  );
  const selected = choices.find((o) => o.id === caseId) || opportunity;
  const [accountId, setAccountId] = useState(
    start.mode === "reply"
      ? !data.gmail_history_enabled
        ? accounts.find((a) => a.id === start.account_id)?.id || ""
        : defaultReplyAccount(
            start.account_id || "",
            accounts.map((a) => a.id),
          )
      : start.account_id ||
          accounts.find((a) => a.id === selected?.primary_account_id)?.id ||
          accounts[0]?.id ||
          "",
  );
  const [mode, setMode] = useState(start.mode || "compose");
  const legacyReply = mode === "reply" && !data.gmail_history_enabled;
  const lenderReply = mode === "reply" && !!start.lender_id;
  useEffect(() => {
    onAccountChange?.(accountId);
  }, [accountId, onAccountChange]);
  const [to, setTo] = useState(start.to_email ?? selected?.email ?? "");
  const [cc, setCc] = useState((start.cc_emails || []).join(", "));
  const suggestedCc = (start.cc_emails || []).join(", ");
  useEffect(() => {
    if (mode === "reply") setCc(suggestedCc);
  }, [suggestedCc, mode]);
  const [bcc, setBcc] = useState((start.bcc_emails || []).join(", "));
  const [subject, setSubject] = useState(start.subject || "");
  const [body, setBody] = useState(start.body || "");
  const [processes, setProcesses] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [process, setProcess] = useState(start.process_id || "");
  const [submission, setSubmission] = useState(start.submission_id || "");
  const [evaluations, setEvaluations] = useState<
    { id: string; lender_id: string; process_id: string | null }[]
  >([]);
  const [contactLender, setContactLender] = useState("");
  const [contactName, setContactName] = useState("");
  const [targetEvaluations, setTargetEvaluations] = useState<
    Record<string, string>
  >(
    Object.fromEntries(
      (start.targets || [])
        .filter((s) => s.submission_id)
        .map((s) => [s.lender_id, s.submission_id!]),
    ),
  );
  const [signatureRevision, setSignatureRevision] = useState(0);
  const [targets, setTargets] = useState<Record<string, string>>(
    Object.fromEntries(
      (start.targets || []).map((l) => [l.lender_id, l.email]),
    ),
  );
  const [targetCopies, setTargetCopies] = useState<Record<string, string[]>>(
    Object.fromEntries(
      (start.targets || []).map((target) => [
        target.lender_id,
        target.cc_emails || [],
      ]),
    ),
  );
  const [packagePreview, setPackagePreview] = useState<ReturnType<
    typeof payload
  > | null>(null);
  const [uploads, setUploads] = useState<
    { id: string; name: string; size: number }[]
  >(
    (start.upload_ids || []).map((id) => ({
      id,
      name: t(locale, "Archivo guardado", "Saved file"),
      size: 0,
    })),
  );
  const [documents, setDocuments] = useState<string[]>(
    start.attachment_ids || [],
  );
  const [gmailFiles, setGmailFiles] = useState<string[]>(
    start.gmail_file_ids || [],
  );
  const [forwardFiles, setForwardFiles] = useState<string[]>(
    start.forward_file_ids || [],
  );
  const [signature, setSignature] = useState<{
    html: string;
    name: string;
  } | null>(null);
  const [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const draftId = useRef(start.id || start.draft_id || crypto.randomUUID());
  const locked = busy || working;
  const submitting = useRef(false);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!inline || (compact && !focusToken)) return;
    if (!compact)
      messageInput.current
        ?.closest(".inline-mail-editor")
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    messageInput.current?.focus({ preventScroll: true });
  }, [inline, compact, focusToken]);
  useEffect(() => {
    if (!caseId || data.demo) return;
    const controller = new AbortController();
    fetch(`/api/conversations/channels?case=${caseId}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        setProcesses(p.processes);
        setEvaluations(p.submissions || []);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [caseId, data.demo]);
  useEffect(() => {
    setSignature(null);
    setError("");
    if (!accountId || data.demo || !data.gmail_history_enabled) return;
    const controller = new AbortController();
    fetch(`/api/mail?signature=${accountId}`, { signal: controller.signal })
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        setSignature(p);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [accountId, data.demo, data.gmail_history_enabled, signatureRevision]);
  const payload = () => ({
    opportunity_id: caseId,
    account_id: accountId,
    mode,
    to_email: to.trim(),
    cc_emails: mailCopies(cc, [to]),
    bcc_emails: mailCopies(bcc, [to, ...mailCopies(cc)]),
    subject,
    body,
    process_id: process || null,
    ...(mode === "reply"
      ? {
          conversation_id: start.conversation_id,
          reply_message_id: start.reply_message_id,
          lender_id: start.lender_id,
        }
      : {}),
    ...(["reply", "forward"].includes(mode)
      ? { submission_id: submission || undefined }
      : {}),
    attachment_ids: documents,
    gmail_file_ids: gmailFiles,
    upload_ids: uploads.map((f) => f.id),
    ...(mode === "forward"
      ? {
          forward_message_id: start.forward_message_id,
          forward_file_ids: forwardFiles,
        }
      : {}),
    targets: Object.entries(targets).map(([lender_id, email]) => ({
      lender_id,
      email,
      cc_emails: (targetCopies[lender_id] || []).filter((e) => e !== email),
      ...(targetEvaluations[lender_id]
        ? { submission_id: targetEvaluations[lender_id] }
        : {}),
    })),
    draft_id: draftId.current,
  });
  async function saveDraft() {
    setWorking(true);
    setError("");
    try {
      const r = await fetch("/api/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft",
          request_id: draftId.current,
          payload: payload(),
        }),
      });
      const p = await r.json();
      if (!r.ok) throw Error(p.error);
      setNotice(
        t(locale, "Borrador guardado en el CRM.", "Draft saved in the CRM."),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    setWorking(true);
    setError("");
    try {
      if (
        uploads.length +
          documents.length +
          gmailFiles.length +
          forwardFiles.length +
          files.length >
        20
      )
        throw Error(
          t(locale, "Máximo 20 adjuntos.", "Maximum 20 attachments."),
        );
      if (
        [...files].reduce(
          (n, f) => n + f.size,
          uploads.reduce((n, f) => n + f.size, 0),
        ) >
        18 * 1024 * 1024
      )
        throw Error(
          t(
            locale,
            "Máximo 18 MB de adjuntos por correo.",
            "Maximum 18 MB of attachments per email.",
          ),
        );
      for (const file of files) {
        const r = await fetch(`/api/mail/uploads?case=${caseId}`, {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
          },
          body: file,
        });
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        setUploads((old) => [...old, p]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  const toggle = (
    id: string,
    checked: boolean,
    set: (fn: (old: string[]) => string[]) => void,
  ) => set((old) => (checked ? [...old, id] : old.filter((x) => x !== id)));
  return (
    <MailEditorFrame
      inline={inline}
      compact={compact}
      title={t(
        locale,
        mode === "reply"
          ? "Responder"
          : mode === "forward"
            ? "Reenviar"
            : "Nuevo correo",
        mode === "reply"
          ? "Reply"
          : mode === "forward"
            ? "Forward"
            : "New email",
      )}
      close={() => {
        if (!locked) close();
      }}
    >
      {inline && (
        <div className="mail-reply-context">
          <strong>
            {t(locale, "Respuesta en el hilo", "Reply in thread")}: {subject}
          </strong>
          {replyContext && (
            <p>
              {replyContext.sender}: {replyContext.body.slice(0, 180)}
            </p>
          )}
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current || locked) return;
          submitting.current = true;
          setError("");
          try {
            if ((!data.gmail_history_enabled || data.demo) && mode !== "reply")
              throw new Error(
                t(
                  locale,
                  "El gestor avanzado de correo no está habilitado.",
                  "The advanced mail manager is not enabled.",
                ),
              );
            const p = payload();
            if (mode === "lenders")
              p.to_email = Object.values(targets)[0] || "";
            if (mode === "lenders") {
              setPackagePreview(p);
              return;
            }
            const result = await act(
              data.gmail_history_enabled && !data.demo
                ? "mail_send"
                : lenderReply && !data.demo
                  ? "lender_reply"
                  : "reply",
              p,
            );
            if ((data.gmail_history_enabled || lenderReply) && !data.demo)
              onQueued?.(p, typeof result === "string" ? result : undefined);
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            submitting.current = false;
          }
        }}
      >
        {(!legacyReply || lenderReply) && (
          <EditorOptions
            compact={compact}
            title={`${t(locale, "Destinatarios y cuenta", "Recipients and account")} · ${to || "—"}`}
          >
            <label className="field mail-editor-case">
              {t(locale, "Expediente", "Case")}
              <select
                required
                disabled={
                  !!opportunity || ["reply", "forward"].includes(mode) || locked
                }
                value={caseId}
                onChange={(e) => {
                  setCaseId(e.target.value);
                  setProcess("");
                  setTargets({});
                  setTargetCopies({});
                  setTargetEvaluations({});
                  setUploads([]);
                  setDocuments([]);
                  setGmailFiles([]);
                  setTo(
                    choices.find((o) => o.id === e.target.value)?.email || "",
                  );
                  draftId.current = crypto.randomUUID();
                }}
              >
                {choices.map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.company} · {o.contact}
                  </option>
                ))}
              </select>
            </label>
            <label className="field mail-editor-sender">
              {t(locale, "Enviar desde", "Send from")}
              <select
                required
                disabled={locked}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">
                  {t(
                    locale,
                    "Selecciona una cuenta autorizada",
                    "Select an authorized account",
                  )}
                </option>
                {accounts.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.email}
                  </option>
                ))}
              </select>
            </label>
            {mode === "reply" && start.account_id !== accountId && (
              <p className="muted">
                {t(
                  locale,
                  "Estás cambiando la cuenta remitente. Conservaremos la relación de respuesta y el expediente; Gmail puede mostrar otro hilo en esta cuenta.",
                  "You are switching the sender. We preserve reply references and the case; Gmail may show a different thread in this mailbox.",
                )}
              </p>
            )}
            {!["reply", "forward"].includes(mode) && (
              <label className="field">
                {t(locale, "Tipo de envío", "Send type")}
                <select
                  disabled={locked}
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value as typeof mode);
                    setCc("");
                    setBcc("");
                  }}
                >
                  <option value="compose">
                    {t(locale, "Correo a un contacto", "Email to a contact")}
                  </option>
                  <option value="lenders">
                    {t(
                      locale,
                      "Correos individuales a lenders",
                      "Individual lender emails",
                    )}
                  </option>
                </select>
              </label>
            )}
            <label className="field mail-editor-process">
              {t(locale, "Proceso de financiación", "Financing process")}
              <select
                disabled={locked || mode === "reply"}
                value={process}
                required={mode === "lenders"}
                onChange={(e) => {
                  setProcess(e.target.value);
                  setTargetEvaluations({});
                }}
              >
                <option value="">
                  {t(
                    locale,
                    "Pendiente de asignar a proceso",
                    "Awaiting process assignment",
                  )}
                </option>
                {processes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {["reply", "forward"].includes(mode) && (
              <label className="field mail-editor-evaluation">
                {t(
                  locale,
                  "Solicitud al lender, si corresponde",
                  "Lender evaluation, if applicable",
                )}
                <select
                  disabled={locked}
                  value={submission}
                  onChange={(e) => setSubmission(e.target.value)}
                >
                  <option value="">
                    {t(locale, "Cliente o equipo", "Customer or team")}
                  </option>
                  {evaluations
                    .filter(
                      (s) =>
                        s.process_id === process &&
                        (!start.lender_id || s.lender_id === start.lender_id),
                    )
                    .map((s) => (
                      <option value={s.id} key={s.id}>
                        {data.lenders.find((l) => l.id === s.lender_id)?.name ||
                          s.lender_id}{" "}
                        · {s.id.slice(0, 8)}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {mode === "lenders" ? (
              <>
                <p>
                  {t(
                    locale,
                    "Cada lender recibirá un correo independiente.",
                    "Each lender receives a separate email.",
                  )}
                </p>
                {data.lenders
                  .filter((l) => !!l.email)
                  .map((l) => (
                    <div className="document-row" key={l.id}>
                      <label>
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={l.id in targets}
                          onChange={(e) =>
                            setTargets((old) => {
                              const next = { ...old };
                              if (e.target.checked) next[l.id] = l.email;
                              else delete next[l.id];
                              return next;
                            })
                          }
                        />
                        {l.name}
                      </label>
                      {l.id in targets && (
                        <select
                          aria-label={l.name}
                          disabled={locked}
                          value={targets[l.id]}
                          onChange={(e) =>
                            setTargets((old) => ({
                              ...old,
                              [l.id]: e.target.value,
                            }))
                          }
                        >
                          {(data.lender_contacts || [])
                            .filter((c) => c.lender_id === l.id)
                            .map((c) => (
                              <option value={c.email} key={c.email}>
                                {c.email}
                              </option>
                            ))}
                        </select>
                      )}
                      {l.id in targets && (
                        <fieldset disabled={locked}>
                          <legend>
                            {t(
                              locale,
                              "Copias (CC) de este lender",
                              "Copies (CC) for this lender",
                            )}
                          </legend>
                          {(data.lender_contacts || [])
                            .filter(
                              (c) =>
                                c.lender_id === l.id &&
                                c.email !== targets[l.id],
                            )
                            .map((c) => (
                              <label
                                key={c.email}
                                className="document-review-confirm"
                              >
                                <input
                                  type="checkbox"
                                  checked={(targetCopies[l.id] || []).includes(
                                    c.email,
                                  )}
                                  onChange={(e) =>
                                    setTargetCopies((old) => ({
                                      ...old,
                                      [l.id]: e.target.checked
                                        ? [...(old[l.id] || []), c.email]
                                        : (old[l.id] || []).filter(
                                            (email) => email !== c.email,
                                          ),
                                    }))
                                  }
                                />
                                {c.name ? `${c.name} · ` : ""}
                                {c.email}
                              </label>
                            ))}
                        </fieldset>
                      )}
                      {l.id in targets && (
                        <select
                          disabled={locked}
                          aria-label={t(
                            locale,
                            "Evaluación del lender",
                            "Lender evaluation",
                          )}
                          value={targetEvaluations[l.id] || ""}
                          onChange={(e) =>
                            setTargetEvaluations((old) => ({
                              ...old,
                              [l.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">
                            {t(
                              locale,
                              "Usar evaluación única o crear borrador",
                              "Use single evaluation or create draft",
                            )}
                          </option>
                          {evaluations
                            .filter(
                              (s) =>
                                s.lender_id === l.id &&
                                s.process_id === process,
                            )
                            .map((s) => (
                              <option value={s.id} key={s.id}>
                                {s.id.slice(0, 8)}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  ))}
              </>
            ) : (
              <>
                <label className="field mail-editor-recipient">
                  {t(locale, "Para", "To")}
                  <input
                    type="email"
                    required
                    disabled={locked}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
                <details className="mail-editor-copies" open={!inline}>
                  <summary>
                    {t(
                      locale,
                      legacyReply
                        ? "CC y CCO"
                        : "CC, CCO y registro de contacto",
                      legacyReply
                        ? "CC and BCC"
                        : "CC, BCC and contact registration",
                    )}
                    {!!cc && ` · ${mailCopies(cc).length} CC`}
                    {!!bcc &&
                      ` · ${mailCopies(bcc).length} ${t(locale, "CCO", "BCC")}`}
                  </summary>
                  <label className="field">
                    CC
                    <input
                      disabled={locked}
                      value={cc}
                      onChange={(e) => setCc(e.target.value)}
                      placeholder={t(
                        locale,
                        "Correos separados por comas",
                        "Comma-separated emails",
                      )}
                    />
                  </label>
                  <label className="field">
                    {t(locale, "CCO · copia oculta", "BCC · hidden copy")}
                    <input
                      disabled={locked}
                      value={bcc}
                      onChange={(e) => setBcc(e.target.value)}
                    />
                  </label>
                  {!legacyReply && (
                    <>
                      <label className="field">
                        {t(
                          locale,
                          "Nombre del contacto, opcional",
                          "Contact name, optional",
                        )}
                        <input
                          maxLength={150}
                          disabled={locked}
                          value={contactName}
                          onChange={(e) => setContactName(e.target.value)}
                        />
                      </label>
                      <label className="field">
                        {t(
                          locale,
                          "Guardar destinatario como",
                          "Register recipient as",
                        )}
                        <select
                          disabled={locked}
                          value={contactLender}
                          onChange={(e) => setContactLender(e.target.value)}
                        >
                          <option value="">
                            {t(
                              locale,
                              "Contacto del cliente",
                              "Customer contact",
                            )}
                          </option>
                          {data.lenders.map((l) => (
                            <option value={l.id} key={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="text-button"
                        type="button"
                        disabled={locked || !to}
                        onClick={async () => {
                          setWorking(true);
                          setError("");
                          try {
                            const r = await fetch("/api/mail", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                action: "contact",
                                request_id: crypto.randomUUID(),
                                payload: {
                                  opportunity_id: caseId,
                                  email: to.trim(),
                                  name: contactName.trim() || to.trim(),
                                  lender_id: contactLender || null,
                                },
                              }),
                            });
                            const p = await r.json();
                            if (!r.ok) throw Error(p.error);
                            setNotice(
                              t(
                                locale,
                                "Destinatario registrado.",
                                "Recipient registered.",
                              ),
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setWorking(false);
                          }
                        }}
                      >
                        {t(
                          locale,
                          "Registrar destinatario",
                          "Register recipient",
                        )}
                      </button>
                    </>
                  )}
                </details>
              </>
            )}
            <label className="field mail-editor-subject">
              {t(locale, "Asunto", "Subject")}
              <input
                required
                maxLength={mode === "reply" ? 2000 : 200}
                disabled={locked || mode === "reply"}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
          </EditorOptions>
        )}
        <label className="field mail-editor-body">
          <span>{t(locale, "Mensaje", "Message")}</span>
          <textarea
            ref={messageInput}
            required
            maxLength={10000}
            rows={compact ? 2 : inline ? 4 : 7}
            placeholder={
              inline
                ? t(locale, "Escribe tu respuesta…", "Write your reply…")
                : undefined
            }
            disabled={locked}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {!legacyReply && (
          <EditorOptions
            compact={compact}
            title={t(locale, "Adjuntos y firma", "Attachments and signature")}
          >
            <details>
              <summary>
                {t(locale, "Documentos del expediente", "Case documents")}
              </summary>
              {data.documents
                .filter(
                  (d) =>
                    d.opportunity_id === caseId &&
                    d.status === "approved" &&
                    d.storage_path,
                )
                .map((d) => (
                  <label className="document-row" key={d.id}>
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={documents.includes(d.id)}
                      onChange={(e) =>
                        toggle(d.id, e.target.checked, setDocuments)
                      }
                    />
                    {d.name}
                  </label>
                ))}
              {(data.gmail_files || [])
                .filter(
                  (f) =>
                    f.opportunity_id === caseId &&
                    f.storage_path &&
                    (data.gmail_history_enabled
                      ? ["received", "approved", "reviewed", "incorporated"]
                      : ["approved"]
                    ).includes(f.status),
                )
                .map((f) => (
                  <label className="document-row" key={f.id}>
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={gmailFiles.includes(f.id)}
                      onChange={(e) =>
                        toggle(f.id, e.target.checked, setGmailFiles)
                      }
                    />
                    {f.name}
                  </label>
                ))}
            </details>
            {!!forwardFiles.length && (
              <p>
                {t(
                  locale,
                  "Adjuntos del mensaje original",
                  "Original message attachments",
                )}
                : {forwardFiles.length}{" "}
                <button
                  type="button"
                  className="text-button"
                  disabled={locked}
                  onClick={() => setForwardFiles([])}
                >
                  {t(
                    locale,
                    "Reenviar sin los adjuntos originales",
                    "Forward without original attachments",
                  )}
                </button>
              </p>
            )}
            <label className="field">
              {t(
                locale,
                "Adjuntar desde el computador · máximo 18 MB en total",
                "Attach from computer · maximum 18 MB total",
              )}
              <input
                type="file"
                multiple
                disabled={
                  locked || !caseId || !data.gmail_history_enabled || data.demo
                }
                onChange={(e) => {
                  void upload(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {uploads.map((f) => (
              <div className="document-row" key={f.id}>
                <a href={`/api/mail/uploads/${f.id}`}>{f.name}</a>
                <button
                  type="button"
                  disabled={locked}
                  className="text-button"
                  onClick={() =>
                    setUploads((old) => old.filter((x) => x.id !== f.id))
                  }
                >
                  {t(locale, "Quitar", "Remove")}
                </button>
              </div>
            ))}
            <p className="muted">
              {data.demo
                ? t(
                    locale,
                    "Demostración sin conexión a Gmail.",
                    "Demo without a Gmail connection.",
                  )
                : signature
                  ? signature.html
                    ? t(
                        locale,
                        "Se añadirá la firma de esta cuenta de Gmail, con su formato y enlaces.",
                        "This Gmail account's formatted signature and links will be added.",
                      )
                    : t(
                        locale,
                        "Esta cuenta no tiene una firma configurada en Gmail.",
                        "This account has no Gmail signature configured.",
                      )
                  : t(
                      locale,
                      "Consultando la firma de Gmail…",
                      "Loading Gmail signature…",
                    )}
            </p>
            {!signature && accountId && !data.demo && (
              <button
                className="text-button"
                type="button"
                disabled={locked}
                onClick={() => setSignatureRevision((n) => n + 1)}
              >
                {t(locale, "Volver a consultar la firma", "Reload signature")}
              </button>
            )}
            {signature?.html && (
              <details>
                <summary>
                  {t(locale, "Vista previa de la firma", "Signature preview")}
                </summary>
                <iframe
                  title={t(locale, "Firma de Gmail", "Gmail signature")}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${signature.html}`}
                  style={{ width: "100%", border: 0 }}
                />
              </details>
            )}
          </EditorOptions>
        )}
        {legacyReply && (
          <small className="muted">
            {t(
              locale,
              lenderReply
                ? "Respuesta al lender desde la cuenta seleccionada, conservando el hilo original. Adjuntos y firma requieren la integración avanzada habilitada."
                : "Respuesta básica desde la cuenta original del hilo. Las opciones avanzadas requieren la integración de Gmail habilitada.",
              lenderReply
                ? "Reply to the lender from the selected account, preserving the original thread. Attachments and signature require the advanced integration."
                : "Basic reply from the original thread account. Advanced options require the Gmail integration to be enabled.",
            )}
          </small>
        )}
        <div className="modal-footer mail-editor-footer">
          {inline && (
            <button
              className="button"
              type="button"
              disabled={locked}
              onClick={close}
            >
              {t(locale, "Cancelar", "Cancel")}
            </button>
          )}
          <button
            type="button"
            className="button"
            disabled={locked || !caseId || data.demo}
            onClick={() => void saveDraft()}
          >
            {t(locale, "Guardar borrador", "Save draft")}
          </button>
          <SaveButton
            locale={locale}
            busy={locked}
            disabled={
              !accountId ||
              !caseId ||
              (!data.demo && data.gmail_history_enabled && !signature)
            }
            label={
              mode === "reply"
                ? t(locale, "Enviar respuesta", "Send reply")
                : mode === "lenders"
                  ? t(
                      locale,
                      "Revisar paquete y correos",
                      "Review package and emails",
                    )
                  : t(locale, "Enviar correo", "Send email")
            }
          />
        </div>
      </form>
      {packagePreview && (
        <Modal
          wide
          title={t(
            locale,
            "Revisar envío a lenders",
            "Review lender submission",
          )}
          close={() => {
            if (!locked) setPackagePreview(null);
          }}
        >
          <p>
            {t(
              locale,
              "Se enviará un correo independiente por lender con los mismos documentos seleccionados.",
              "A separate email will be sent to each lender with the same selected documents.",
            )}
          </p>
          {packagePreview.targets.map((target) => (
            <p key={target.lender_id}>
              <strong>
                {data.lenders.find((l) => l.id === target.lender_id)?.name}
              </strong>
              <br />
              To: {target.email}
              <br />
              CC: {target.cc_emails.join(", ") || "—"}
            </p>
          ))}
          <h3>{packagePreview.subject}</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{packagePreview.body}</p>
          <h3>{t(locale, "Archivos seleccionados", "Selected files")}</h3>
          <ul>
            {packagePreview.attachment_ids.map((id) => (
              <li key={id}>{data.documents.find((d) => d.id === id)?.name}</li>
            ))}
            {packagePreview.gmail_file_ids.map((id) => (
              <li key={id}>
                {data.gmail_files?.find((d) => d.id === id)?.name || id}
              </li>
            ))}
            {uploads
              .filter((f) => packagePreview.upload_ids.includes(f.id))
              .map((f) => (
                <li key={f.id}>{f.name}</li>
              ))}
          </ul>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <div className="modal-footer">
            <button
              className="button"
              disabled={locked}
              onClick={() => setPackagePreview(null)}
            >
              {t(locale, "Volver a editar", "Back to editing")}
            </button>
            <button
              className="button primary"
              disabled={locked || submitting.current}
              onClick={async () => {
                if (submitting.current) return;
                submitting.current = true;
                setError("");
                try {
                  const result = await act("mail_send", packagePreview);
                  onQueued?.(
                    packagePreview,
                    typeof result === "string" ? result : undefined,
                  );
                  setPackagePreview(null);
                  close();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  submitting.current = false;
                }
              }}
            >
              {t(locale, "Confirmar y enviar", "Confirm and send")}
            </button>
          </div>
        </Modal>
      )}
    </MailEditorFrame>
  );
}

function MailEditorFrame({
  inline,
  compact,
  title,
  close,
  children,
}: {
  inline: boolean;
  compact: boolean;
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  if (!inline)
    return (
      <Modal title={title} close={close}>
        {children}
      </Modal>
    );
  return (
    <section
      className={`inline-mail-editor ${compact ? "compact-mail-editor" : ""}`}
      aria-label={title}
    >
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function EditorOptions({
  compact,
  title,
  children,
}: {
  compact: boolean;
  title: string;
  children: ReactNode;
}) {
  if (!compact) return <>{children}</>;
  return (
    <details className="cw-reply-options">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
