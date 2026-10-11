"use client";
import { useEffect, useState, useRef } from "react";
import type { Conversation, Message, Locale, Workspace } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import type { Action } from "./crm";
import { t, Empty, SaveButton } from "./ui";
import { MailBody } from "./mail-bubble";
import { messageChannels, suggestedReply } from "@/lib/mail-display";
import { teamLabel } from "@/lib/gmail-team";
type Channels = {
  conversations: Conversation[];
  processes: { id: string; label: string; sequence_number: number }[];
  routes: { conversation_id: string; lender_id: string }[];
  lenders: { id: string; name: string; email: string }[];
  lender_contacts: { email: string; lender_id: string }[];
  team_emails: string[];
  client_emails: string[];
};
type Page = {
  messages: Message[];
  attachments: NonNullable<Workspace["attachments"]>;
  hasMore: boolean;
};
const empty: Channels = {
  conversations: [],
  processes: [],
  routes: [],
  lenders: [],
  lender_contacts: [],
  team_emails: [],
  client_emails: [],
};
export function MailInbox({
  data,
  locale,
  act,
  busy,
  openCase,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  busy: boolean;
  openCase: (id: string) => void;
}) {
  const [caseId, setCaseId] = useState(data.opportunities[0]?.id || "");
  const [metadata, setMetadata] = useState<Channels>(empty);
  const [process, setProcess] = useState("");
  const [channel, setChannel] = useState("client");
  const [pages, setPages] = useState<Record<string, Page>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [reply, setReply] = useState<Message | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const generation = useRef(0);
  const pageGeneration = useRef(0);
  const accounts = data.accounts.filter(
    (a) => a.status === "connected" && data.sender_account_ids?.includes(a.id),
  );
  useEffect(() => {
    if (!caseId && data.opportunities[0]) setCaseId(data.opportunities[0].id);
  }, [caseId, data.opportunities]);
  useEffect(() => {
    if (!caseId) return;
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setReply(null);
    (async () => {
      try {
        const r = await fetch(`/api/conversations/channels?case=${caseId}`, {
          signal: controller.signal,
        });
        const body = await r.json();
        if (!r.ok) throw Error(body.error);
        if (current !== generation.current) return;
        setMetadata(body);
        setPages({});
        setProcess((old) =>
          body.processes.some((p: { id: string }) => p.id === old)
            ? old
            : body.processes[0]?.id || "",
        );
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (current === generation.current) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [caseId, revision]);
  const threads = metadata.conversations.filter(
    (c) => (c.process_id || "") === process,
  );
  useEffect(() => {
    const controller = new AbortController();
    ++pageGeneration.current;
    setError("");
    setReply(null);
    setLoading(true);
    (async () => {
      try {
        const results = await Promise.all(
          threads.map(async (c) => {
            const r = await fetch(`/api/conversations/${c.id}/messages`, {
              signal: controller.signal,
            });
            const p = await r.json();
            if (!r.ok) throw Error(p.error);
            return [c.id, p] as const;
          }),
        );
        if (!controller.signal.aborted) setPages(Object.fromEntries(results));
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [metadata, process]);
  const all = Object.values(pages)
    .flatMap((p) => p.messages)
    .filter((m) => threads.some((c) => c.id === m.conversation_id));
  const seen = new Set<string>();
  const messages = all
    .sort(
      (a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id),
    )
    .filter((m) => {
      const key = m.internet_message_id || m.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const channelOf = (m: Message) => {
    const co = metadata.conversations.find((c) => c.id === m.conversation_id);
    const sub = data.submissions.find((s) => s.id === co?.submission_id);
    const permitted = new Set(
      metadata.routes
        .filter((r) => r.conversation_id === m.conversation_id)
        .map((r) => r.lender_id),
    );
    return messageChannels(m, {
      team: metadata.team_emails,
      clients: metadata.client_emails,
      lenders: metadata.lender_contacts.filter((l) =>
        permitted.has(l.lender_id),
      ),
      fallbackLender: sub?.lender_id,
    });
  };
  const visible = messages.filter((m) => channelOf(m).includes(channel));
  const lenderId = channel.startsWith("lender:") ? channel.slice(7) : undefined;
  const options = [
    { id: "client", name: t(locale, "Cliente", "Customer") },
    { id: "team", name: t(locale, "Equipo", "Team") },
    ...metadata.lenders
      .filter((l) =>
        metadata.routes.some(
          (r) =>
            r.lender_id === l.id &&
            threads.some((c) => c.id === r.conversation_id),
        ),
      )
      .map((l) => ({ id: `lender:${l.id}`, name: l.name })),
    {
      id: "review",
      name: t(locale, "Participantes por asociar", "Participants to associate"),
    },
  ];
  function chooseReply(m: Message) {
    setReply(m);
    const peers = lenderId
      ? metadata.lender_contacts
          .filter((l) => l.lender_id === lenderId)
          .map((l) => l.email)
      : channel === "team"
        ? metadata.team_emails
        : metadata.client_emails;
    const thread = metadata.conversations.find(
      (c) => c.id === m.conversation_id,
    );
    const from =
      accounts.find((a) => a.id === thread?.account_id) || accounts[0];
    const own =
      channel === "team"
        ? from
          ? [from.email]
          : []
        : data.accounts.map((a) => a.email);
    const suggested = suggestedReply(m.participants || [], m.sender, own, [
      ...peers,
      ...metadata.team_emails,
    ]);
    setTo(suggested.to || peers.find((e) => !own.includes(e)) || "");
    setCc(suggested.cc.join(", "));
  }
  async function older() {
    const current = pageGeneration.current;
    setLoading(true);
    setError("");
    try {
      const additions = await Promise.all(
        threads
          .filter((c) => pages[c.id]?.hasMore)
          .map(async (c) => {
            const first = pages[c.id].messages[0];
            if (!first) return [c.id, pages[c.id]] as const;
            const r = await fetch(
              `/api/conversations/${c.id}/messages?${new URLSearchParams({ before: first.sent_at, cursor: first.id })}`,
            );
            const p = await r.json();
            if (!r.ok) throw Error(p.error);
            return [
              c.id,
              {
                ...p,
                messages: [...p.messages, ...pages[c.id].messages],
                attachments: [...p.attachments, ...pages[c.id].attachments],
              },
            ] as const;
          }),
      );
      if (current === pageGeneration.current)
        setPages((old) => ({ ...old, ...Object.fromEntries(additions) }));
    } catch (e) {
      if (current === pageGeneration.current) setError((e as Error).message);
    } finally {
      if (current === pageGeneration.current) setLoading(false);
    }
  }
  return (
    <section className="panel inbox mail-inbox">
      <aside className="conversation-list">
        <h2>
          {t(locale, "Conversaciones por cliente", "Customer conversations")}
        </h2>
        <label className="field">
          {t(locale, "Empresa / cliente", "Company / customer")}
          <select
            value={caseId}
            onChange={(e) => {
              setCaseId(e.target.value);
              setChannel("client");
            }}
          >
            {data.opportunities.map((o) => (
              <option value={o.id} key={o.id}>
                {o.company} · {o.email}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t(locale, "Proceso de financiación", "Financing process")}
          <select value={process} onChange={(e) => setProcess(e.target.value)}>
            <option value="">
              {t(locale, "Sin proceso asignado", "No process assigned")}
            </option>
            {metadata.processes.map((p) => (
              <option value={p.id} key={p.id}>
                {p.sequence_number} · {p.label}
              </option>
            ))}
          </select>
        </label>
        {options.map((o) => (
          <button
            key={o.id}
            className={channel === o.id ? "active" : ""}
            onClick={() => {
              setChannel(o.id);
              setReply(null);
            }}
          >
            <strong>{o.name}</strong>
            <small>
              {messages.filter((m) => channelOf(m).includes(o.id)).length}{" "}
              {t(locale, "mensajes cargados", "loaded messages")}
            </small>
          </button>
        ))}
      </aside>
      <div className="conversation-content">
        <div className="conversation-header">
          <h2>{options.find((o) => o.id === channel)?.name}</h2>
          <button className="text-button" onClick={() => openCase(caseId)}>
            {t(locale, "Ver expediente", "View case")}
          </button>
          <button
            className="text-button"
            disabled={loading}
            onClick={() => setRevision((r) => r + 1)}
          >
            {t(locale, "Actualizar", "Refresh")}
          </button>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <div className="messages">
          {loading && (
            <p role="status">
              {t(locale, "Cargando mensajes…", "Loading messages…")}
            </p>
          )}
          {Object.values(pages).some((p) => p.hasMore) && (
            <button className="button" disabled={loading} onClick={older}>
              {t(locale, "Cargar mensajes anteriores", "Load earlier messages")}
            </button>
          )}
          {visible.map((m) => (
            <article
              className={`message ${m.direction === "outbound" || m.sender_team || metadata.team_emails.includes(m.sender) ? "outbound" : "inbound"}`}
              key={m.id}
            >
              <div>
                <strong>{m.sender}</strong>
                {m.sender_team && (
                  <small>{teamLabel(m.sender_team, locale)}</small>
                )}
                <small>{dateLabel(m.sent_at, locale, true)}</small>
              </div>
              <small>
                {
                  metadata.conversations.find((c) => c.id === m.conversation_id)
                    ?.subject
                }
              </small>
              <MailBody body={m.body} locale={locale} />
              <details>
                <summary>{t(locale, "Destinatarios", "Recipients")}</summary>
                {(m.participants || []).map((p, i) => (
                  <p key={i}>
                    {p.role}: {p.email}
                  </p>
                ))}
              </details>
              {(data.gmail_files || [])
                .filter((f) => f.archive_message_id === m.archive_message_id)
                .map((f) => (
                  <a
                    className="button"
                    key={f.id}
                    href={`/api/gmail/files/${f.id}`}
                  >
                    {f.name} · {t(locale, "Descargar", "Download")}
                  </a>
                ))}
              {channel !== "review" && (
                <button className="text-button" onClick={() => chooseReply(m)}>
                  {t(
                    locale,
                    "Responder a este mensaje",
                    "Reply to this message",
                  )}
                </button>
              )}
            </article>
          ))}
          {!loading && !visible.length && (
            <Empty
              title={t(
                locale,
                "No hay mensajes cargados en esta conversación",
                "No messages loaded in this conversation",
              )}
            />
          )}
        </div>
        {reply && (
          <form
            className="reply-form"
            key={`${reply.id}:${channel}`}
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              setError("");
              try {
                await act("reply", {
                  conversation_id: reply.conversation_id,
                  reply_message_id: reply.id,
                  to_email: to.trim(),
                  cc_emails: cc
                    .split(/[,;]+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                  ...(lenderId ? { lender_id: lenderId } : {}),
                  account_id: f.get("account_id"),
                  body: f.get("body"),
                  attachment_ids: f.getAll("attachment_id"),
                  gmail_file_ids: f.getAll("gmail_file_id"),
                });
                setReply(null);
                setRevision((r) => r + 1);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <p>
              {t(locale, "Respuesta a", "Reply to")}: {reply.sender} ·{" "}
              {dateLabel(reply.sent_at, locale, true)}
            </p>
            <label>
              {t(locale, "Enviar desde", "Send from")}
              <select
                required
                name="account_id"
                defaultValue={
                  accounts.find(
                    (a) =>
                      a.id ===
                      metadata.conversations.find(
                        (c) => c.id === reply.conversation_id,
                      )?.account_id,
                  )?.id || accounts[0]?.id
                }
              >
                {accounts.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t(locale, "Para", "To")}
              <input
                required
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <label>
              {t(
                locale,
                "Copias visibles (CC), separadas por comas",
                "Visible copies (CC), separated by commas",
              )}
              <input value={cc} onChange={(e) => setCc(e.target.value)} />
            </label>
            <details>
              <summary>
                {t(
                  locale,
                  "Adjuntar documentos aprobados",
                  "Attach approved documents",
                )}
              </summary>
              {data.documents
                .filter(
                  (d) =>
                    d.opportunity_id === caseId &&
                    d.status === "approved" &&
                    d.storage_path,
                )
                .map((d) => (
                  <label key={d.id}>
                    <input type="checkbox" name="attachment_id" value={d.id} />
                    {d.name}
                  </label>
                ))}
              {(data.gmail_files || [])
                .filter(
                  (d) =>
                    d.opportunity_id === caseId &&
                    d.status === "approved" &&
                    d.storage_path,
                )
                .map((d) => (
                  <label key={d.id}>
                    <input type="checkbox" name="gmail_file_id" value={d.id} />
                    {d.name}
                  </label>
                ))}
            </details>
            <textarea
              name="body"
              required
              maxLength={10000}
              rows={4}
              placeholder={t(
                locale,
                "Escribe tu respuesta…",
                "Write your reply…",
              )}
            />
            <p>
              {t(
                locale,
                "Revisa Para y CC antes de enviar. La respuesta queda vinculada al mensaje y al proceso seleccionados.",
                "Review To and CC before sending. The reply stays linked to the selected message and process.",
              )}
            </p>
            <SaveButton
              locale={locale}
              busy={busy}
              disabled={!accounts.length}
              label={t(locale, "Enviar respuesta", "Send reply")}
            />
          </form>
        )}
      </div>
    </section>
  );
}
