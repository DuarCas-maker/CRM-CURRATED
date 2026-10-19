"use client";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import type { MailSnapshot } from "@/lib/gmail-history";
import { Modal, t } from "./ui";
import { MailBody } from "./mail-bubble";
import { teamLabel } from "@/lib/gmail-team";
type Archived = MailSnapshot & { archive_id: string };
export function MailThreadEvidence({
  id,
  locale,
  close,
}: {
  id: string;
  locale: Locale;
  close: () => void;
}) {
  const [messages, setMessages] = useState<Archived[]>([]),
    [cursor, setCursor] = useState<{ before: string; cursor: string } | null>(
      null,
    ),
    [hasMore, setHasMore] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  async function load(
    before?: { before: string; cursor: string },
    signal?: AbortSignal,
  ) {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        `/api/gmail/archive/${id}/thread${before ? `?${new URLSearchParams(before)}` : ""}`,
        { signal },
      );
      const p = await r.json();
      if (!r.ok) throw Error(p.error);
      if (signal?.aborted) return;
      setMessages((old) => (before ? [...p.messages, ...old] : p.messages));
      setCursor(p.cursor);
      setHasMore(p.hasMore);
    } catch (e) {
      if (!signal?.aborted) setError((e as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setMessages([]);
    load(undefined, controller.signal);
    return () => controller.abort();
  }, [id]);
  return (
    <Modal
      locale={locale}
      wide
      title={
        messages.at(-1)?.subject ||
        t(locale, "Conversación de origen", "Source conversation")
      }
      close={close}
    >
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <p role="status">
          {t(locale, "Cargando conversación…", "Loading conversation…")}
        </p>
      )}
      {hasMore && cursor && (
        <button
          className="button"
          disabled={loading}
          onClick={() => load(cursor)}
        >
          {t(locale, "Cargar mensajes anteriores", "Load earlier messages")}
        </button>
      )}
      <div className="messages source-chat">
        {messages.map((m) => {
          const sender = m.participants.find((p) => p.role === "from");
          return (
            <article
              className={`message ${m.direction === "outbound" || sender?.team ? "outbound" : "inbound"}`}
              key={m.archive_id}
            >
              <div>
                <strong>
                  {sender?.name} · {sender?.email}
                </strong>
                {sender?.team && (
                  <small>{teamLabel(sender.team, locale)}</small>
                )}
                <small>{dateLabel(m.sent_at, locale, true)}</small>
              </div>
              <MailBody body={m.body} locale={locale} />
              <details>
                <summary>{t(locale, "Destinatarios", "Recipients")}</summary>
                {m.participants.map((p, i) => (
                  <p key={i}>
                    {p.role}: {p.email}
                  </p>
                ))}
              </details>
              {m.attachments.map((a) => (
                <small key={a.part_id}>
                  {a.name} · {Math.round(a.size / 1024)} KB
                </small>
              ))}
            </article>
          );
        })}
      </div>
    </Modal>
  );
}
