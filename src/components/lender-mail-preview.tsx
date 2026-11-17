"use client";
import { useState } from "react";
import { Eye, Paperclip, MailCheck } from "lucide-react";
import type { Locale } from "@/lib/domain";
import {
  messagePreviewDocument,
  type LenderReview,
} from "@/lib/lender-templates";
import { t } from "./ui";

export function LenderMailPreview({
  messages,
  signature,
  locale,
  files = 0,
  final = false,
}: {
  messages: LenderReview["messages"];
  signature?: { html: string; name: string } | null;
  locale: Locale;
  files?: number;
  final?: boolean;
}) {
  const [selected, setSelected] = useState("");
  const message = messages.find((m) => m.lender_id === selected) || messages[0];
  return (
    <section
      className="lender-mail-preview"
      aria-label={t(locale, "Vista previa del mensaje", "Message preview")}
    >
      <header>
        <span className="mail-section-icon">
          <Eye size={18} />
        </span>
        <div>
          <h3>
            {t(
              locale,
              final ? "Así se enviará" : "Vista previa",
              final ? "Ready to send" : "Live preview",
            )}
          </h3>
          <p>
            {t(
              locale,
              final
                ? "Contenido verificado con los registros actuales."
                : "Con los datos de este expediente.",
              final
                ? "Verified against current records."
                : "Using this case's data.",
            )}
          </p>
        </div>
      </header>
      {messages.length > 0 ? (
        <>
          <label className="field">
            {t(locale, "Ver correo para", "Preview email to")}
            <select
              value={message.lender_id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {messages.map((m) => (
                <option key={m.lender_id} value={m.lender_id}>
                  {m.lender_name}
                </option>
              ))}
            </select>
          </label>
          <div className="mail-preview-envelope">
            <p>
              <strong>To</strong>
              <span>
                {message.email ||
                  t(locale, "Falta correo válido", "Valid email missing")}
              </span>
            </p>
            <p>
              <strong>CC</strong>
              <span>{message.cc_emails.join(", ") || "—"}</span>
            </p>
            <p>
              <strong>{t(locale, "Asunto", "Subject")}</strong>
              <span>
                {message.subject ||
                  t(locale, "Escribe un asunto", "Add a subject")}
              </span>
            </p>
          </div>
          {!!message.missing.length && (
            <div className="mail-missing-fields" role="alert">
              <strong>
                {t(
                  locale,
                  "Faltan datos para enviar",
                  "Missing required values",
                )}
              </strong>
              <div>
                {message.missing.map((key) => (
                  <code key={key}>{`{{${key}}}`}</code>
                ))}
              </div>
              <small>
                {t(
                  locale,
                  "Completa el expediente o reemplaza estas variables en el mensaje. Los campos resaltados no se enviarán.",
                  "Complete the case or replace these fields in the message. Highlighted fields will not be sent.",
                )}
              </small>
            </div>
          )}
          {message.error ? (
            <p className="error-banner" role="alert">
              {message.error}
            </p>
          ) : (
            <iframe
              title={t(locale, "Correo personalizado", "Personalized email")}
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={messagePreviewDocument(message.html, signature?.html)}
            />
          )}
          <div className="mail-preview-foot">
            <span>
              <Paperclip size={14} />
              {files} {t(locale, "adjuntos", "attachments")}
            </span>
            <span>
              <MailCheck size={14} />
              {messages.length}{" "}
              {t(locale, "correos individuales", "individual emails")}
            </span>
          </div>
          <small className="muted">
            {t(
              locale,
              "Cada lender recibe solo su correo y sus copias. Los límites de entrega de la cuenta siguen vigentes.",
              "Each lender receives only their own message and copies. The account's delivery limits still apply.",
            )}
          </small>
        </>
      ) : (
        <div className="mail-preview-empty">
          <Eye size={30} />
          <p>
            {t(
              locale,
              "Selecciona lenders y escribe un mensaje para ver el resultado aquí.",
              "Select lenders and write a message to preview it here.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}
