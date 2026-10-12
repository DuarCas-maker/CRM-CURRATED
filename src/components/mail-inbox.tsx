"use client";
import { useEffect, useState, useRef } from "react";
import type {
  Conversation,
  Message,
  Locale,
  Workspace,
  Opportunity,
} from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import type { Action } from "./crm";
import { t, Empty, Modal } from "./ui";
import { MailEditor } from "./mail-editor";
import { MailboxStatus } from "./mailbox-status";
import { forwardedBody, type MailDraft } from "@/lib/mail-manager";
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
  stats?: {
    sent: number;
    received: number;
    threads: number;
    lenders_contacted: number;
  };
  submissions?: { id: string; lender_id: string; process_id: string | null }[];
};
type Page = {
  messages: Message[];
  attachments: NonNullable<Workspace["attachments"]>;
  hasMore: boolean;
  files: {
    message_id: string;
    id: string;
    name: string;
    href: string;
    last_error?: string | null;
  }[];
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
  opportunity,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  busy: boolean;
  openCase: (id: string) => void;
  opportunity?: Opportunity;
}) {
  const [caseId, setCaseId] = useState(
    opportunity?.id || data.opportunities[0]?.id || "",
  );
  const [metadata, setMetadata] = useState<Channels>(empty);
  const [process, setProcess] = useState("all");
  const [channel, setChannel] = useState("all");
  const [pages, setPages] = useState<Record<string, Page>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<MailDraft | null>(null);
  const [search, setSearch] = useState("");
  const [originalThread, setOriginalThread] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const generation = useRef(0);
  const pageGeneration = useRef(0);
  const loadedSource = useRef("");
  const accounts = data.accounts.filter(
    (a) => a.status === "connected" && data.sender_account_ids?.includes(a.id),
  );
  useEffect(() => {
    if (opportunity?.id) setCaseId(opportunity.id);
  }, [opportunity?.id]);
  useEffect(() => {
    setReply(null);
    setEditing(null);
    setOriginalThread(null);
  }, [caseId, process, channel]);
  useEffect(() => {
    setPages({});
    loadedSource.current = "";
  }, [caseId, process, search]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setRevision((r) => r + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!caseId && data.opportunities[0]) setCaseId(data.opportunities[0].id);
  }, [caseId, data.opportunities]);
  useEffect(() => {
    if (!caseId) return;
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const r = await fetch(`/api/conversations/channels?case=${caseId}`, {
          signal: controller.signal,
        });
        const body = await r.json();
        if (!r.ok) throw Error(body.error);
        if (current !== generation.current) return;
        setMetadata(body);
        setProcess((old) =>
          old === "all" ||
          body.processes.some((p: { id: string }) => p.id === old)
            ? old
            : "all",
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
    (c) => process === "all" || (c.process_id || "") === process,
  );
  useEffect(() => {
    if (metadata.conversations.some((c) => c.opportunity_id !== caseId)) return;
    const controller = new AbortController();
    ++pageGeneration.current;
    setError("");
    setLoading(true);
    (async () => {
      try {
        const results = await Promise.all(
          threads.map(async (c) => {
            const r = await fetch(
              `/api/conversations/${c.id}/messages?${new URLSearchParams({ q: search })}`,
              {
                signal: controller.signal,
              },
            );
            const p = await r.json();
            if (!r.ok) throw Error(p.error);
            return [c.id, p] as const;
          }),
        );
        if (!controller.signal.aborted) {
          const key = `${caseId}:${process}:${search}`;
          const preserve = loadedSource.current === key;
          setPages((old) =>
            Object.fromEntries(
              results.map(([id, page]) => {
                const previous = preserve ? old[id] : undefined;
                const overlap = previous?.messages.some((m) =>
                  page.messages.some((n: Message) => n.id === m.id),
                );
                if (!previous || !overlap) return [id, page];
                return [
                  id,
                  {
                    ...page,
                    hasMore: previous.hasMore,
                    messages: [
                      ...new Map(
                        [...previous.messages, ...page.messages].map((m) => [
                          m.id,
                          m,
                        ]),
                      ).values(),
                    ].sort(
                      (a, b) =>
                        a.sent_at.localeCompare(b.sent_at) ||
                        a.id.localeCompare(b.id),
                    ),
                    attachments: [
                      ...new Map(
                        [...previous.attachments, ...page.attachments].map(
                          (f) => [f.id, f],
                        ),
                      ).values(),
                    ],
                    files: [
                      ...new Map(
                        [...(previous.files || []), ...(page.files || [])].map(
                          (f) => [`${f.message_id}:${f.id}`, f],
                        ),
                      ).values(),
                    ],
                  },
                ];
              }),
            ),
          );
          loadedSource.current = key;
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [metadata, process, search, caseId]);
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
    const sub = metadata.submissions?.find((s) => s.id === co?.submission_id);
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
  const visible = messages.filter(
    (m) => channel === "all" || channelOf(m).includes(channel),
  );
  const lenderId = channel.startsWith("lender:") ? channel.slice(7) : undefined;
  const options = [
    { id: "all", name: t(locale, "Todos los correos", "All emails") },
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
  function chooseReply(m: Message, all = false) {
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
    const suggested = suggestedReply(m.participants || [], m.sender, own);
    const previousRecipient = (m.participants || []).find(
      (p) => p.role === "to" && !own.includes(p.email),
    )?.email;
    setTo(
      suggested.to ||
        previousRecipient ||
        peers.find((e) => !own.includes(e)) ||
        "",
    );
    setCc(all ? suggested.cc.join(", ") : "");
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
              `/api/conversations/${c.id}/messages?${new URLSearchParams({ before: first.sent_at, cursor: first.id, q: search })}`,
            );
            const p = await r.json();
            if (!r.ok) throw Error(p.error);
            return [
              c.id,
              {
                ...p,
                messages: [...p.messages, ...pages[c.id].messages],
                attachments: [...p.attachments, ...pages[c.id].attachments],
                files: [...(p.files || []), ...(pages[c.id].files || [])],
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
    <>
      <MailboxStatus
        data={data}
        locale={locale}
        caseId={caseId}
        onChanged={() => setRevision((r) => r + 1)}
        onDraft={setEditing}
      />
      <section className="panel inbox mail-inbox">
        <aside className="conversation-list">
          <h2>
            {t(locale, "Conversaciones por cliente", "Customer conversations")}
          </h2>
          <label className="field">
            {t(locale, "Empresa / cliente", "Company / customer")}
            <select
              disabled={!!opportunity}
              value={caseId}
              onChange={(e) => {
                setCaseId(e.target.value);
                setChannel("all");
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
            <select
              value={process}
              onChange={(e) => setProcess(e.target.value)}
            >
              <option value="all">
                {t(locale, "Todos los procesos", "All processes")}
              </option>
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
                {
                  messages.filter(
                    (m) => o.id === "all" || channelOf(m).includes(o.id),
                  ).length
                }{" "}
                {t(locale, "mensajes cargados", "loaded messages")}
              </small>
            </button>
          ))}
        </aside>
        <div className="conversation-content">
          {metadata.stats && (
            <p>
              {t(locale, "Enviados", "Sent")}: {metadata.stats.sent} ·{" "}
              {t(locale, "Recibidos", "Received")}: {metadata.stats.received} ·{" "}
              {t(locale, "Hilos", "Threads")}: {metadata.stats.threads} ·{" "}
              {t(locale, "Lenders contactados", "Contacted lenders")}:{" "}
              {metadata.stats.lenders_contacted}
            </p>
          )}
          <div className="conversation-header">
            <h2>{options.find((o) => o.id === channel)?.name}</h2>
            {!opportunity && (
              <button className="text-button" onClick={() => openCase(caseId)}>
                {t(locale, "Ver expediente", "View case")}
              </button>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <label className="field">
            {t(
              locale,
              "Buscar en el correo del expediente",
              "Search case email",
            )}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(locale, "Texto o remitente", "Text or sender")}
            />
          </label>
          <div className="messages">
            {loading && (
              <p role="status">
                {t(locale, "Cargando mensajes…", "Loading messages…")}
              </p>
            )}
            {Object.values(pages).some((p) => p.hasMore) && (
              <button className="button" disabled={loading} onClick={older}>
                {t(
                  locale,
                  "Cargar mensajes anteriores",
                  "Load earlier messages",
                )}
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
                    metadata.conversations.find(
                      (c) => c.id === m.conversation_id,
                    )?.subject
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
                {Object.values(pages)
                  .flatMap((p) => p.files || [])
                  .filter((f) => f.message_id === m.id)
                  .map((f) => (
                    <a className="button" key={f.id} href={f.href}>
                      {f.name} · {t(locale, "Descargar", "Download")}{" "}
                      {f.last_error &&
                        ` · ${t(locale, "Copia pendiente de revisión", "Copy requires review")}`}
                    </a>
                  ))}
                {
                  <button
                    className="text-button"
                    onClick={() => chooseReply(m)}
                  >
                    {t(locale, "Responder", "Reply")}
                  </button>
                }
                {
                  <button
                    className="text-button"
                    onClick={() => chooseReply(m, true)}
                  >
                    {t(locale, "Responder a todos", "Reply all")}
                  </button>
                }
                <button
                  className="text-button"
                  onClick={() => {
                    const c = metadata.conversations.find(
                      (c) => c.id === m.conversation_id,
                    );
                    setEditing({
                      mode: "forward",
                      forward_message_id: m.id,
                      forward_file_ids: [
                        ...new Set(
                          Object.values(pages)
                            .flatMap((p) => p.files || [])
                            .filter((f) => f.message_id === m.id)
                            .map((f) => f.id),
                        ),
                      ],
                      opportunity_id: caseId,
                      account_id: c?.account_id,
                      process_id: c?.process_id,
                      subject: ("Fwd: " + (c?.subject || "")).slice(0, 200),
                      to_email: "",
                      body: forwardedBody(
                        m.sender,
                        dateLabel(m.sent_at, locale, true),
                        c?.subject || "",
                        m.body,
                      ),
                    });
                  }}
                >
                  {t(locale, "Reenviar", "Forward")}
                </button>
                <button
                  className="text-button"
                  onClick={() => setOriginalThread(m.conversation_id)}
                >
                  {t(locale, "Abrir hilo original", "Open original thread")}
                </button>
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
            <MailEditor
              data={data}
              locale={locale}
              act={act}
              busy={busy}
              close={() => {
                setReply(null);
                setRevision((r) => r + 1);
              }}
              opportunity={data.opportunities.find((o) => o.id === caseId)}
              start={{
                mode: "reply",
                opportunity_id: caseId,
                conversation_id: reply.conversation_id,
                reply_message_id: reply.id,
                account_id: metadata.conversations.find(
                  (c) => c.id === reply.conversation_id,
                )?.account_id,
                process_id: metadata.conversations.find(
                  (c) => c.id === reply.conversation_id,
                )?.process_id,
                submission_id:
                  metadata.submissions?.find(
                    (s) =>
                      s.lender_id === lenderId &&
                      s.process_id ===
                        metadata.conversations.find(
                          (c) => c.id === reply.conversation_id,
                        )?.process_id,
                  )?.id ||
                  metadata.conversations.find(
                    (c) => c.id === reply.conversation_id,
                  )?.submission_id ||
                  undefined,
                subject: metadata.conversations.find(
                  (c) => c.id === reply.conversation_id,
                )?.subject,
                to_email: to,
                cc_emails: cc.split(/[,;]+/).filter(Boolean),
              }}
            />
          )}
        </div>
      </section>
      {originalThread && (
        <Modal
          title={
            metadata.conversations.find((c) => c.id === originalThread)
              ?.subject || t(locale, "Hilo original", "Original thread")
          }
          close={() => setOriginalThread(null)}
        >
          <p>
            {
              data.accounts.find(
                (a) =>
                  a.id ===
                  metadata.conversations.find((c) => c.id === originalThread)
                    ?.account_id,
              )?.email
            }
          </p>
          {pages[originalThread]?.hasMore && (
            <button
              className="button"
              disabled={loading}
              onClick={() => void older()}
            >
              {t(locale, "Cargar anteriores", "Load earlier messages")}
            </button>
          )}
          {messages
            .filter((m) => m.conversation_id === originalThread)
            .map((m) => (
              <article className="document-row" key={m.id}>
                <div>
                  <strong>{m.sender}</strong>
                  <small>{dateLabel(m.sent_at, locale, true)}</small>
                  <MailBody body={m.body} locale={locale} />
                </div>
              </article>
            ))}
        </Modal>
      )}
      {editing && (
        <MailEditor
          data={data}
          locale={locale}
          act={act}
          busy={busy}
          start={editing}
          close={() => {
            setEditing(null);
            setRevision((r) => r + 1);
          }}
        />
      )}
    </>
  );
}
