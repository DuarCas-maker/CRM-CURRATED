"use client";
import { CheckCircle2, Paperclip } from "lucide-react";
import type { Locale, Workspace } from "@/lib/domain";
import type { MailVisibleFile } from "@/lib/mail-files";
import { attachmentProcessingLabels } from "@/lib/attachment-processing";
import { t } from "./ui";
export function MailAttachments({
  data,
  locale,
  files,
  legacyAttachments = [],
  onFileReview,
  onAttachment,
}: {
  data: Workspace;
  locale: Locale;
  files: MailVisibleFile[];
  legacyAttachments?: NonNullable<Workspace["attachments"]>;
  onFileReview?: (file: MailVisibleFile) => void;
  onAttachment?: (
    attachment: NonNullable<Workspace["attachments"]>[number],
  ) => void;
}) {
  return (
    <>
      {" "}
      {!!files.length && (
        <div className="cw-message-files">
          {files.map((f) => {
            const status =
              f.processing_status ||
              (f.imported_document_id ? "linked" : "pending");
            return (
              <span key={f.id} className={`cw-attachment ${status}`}>
                <a key={f.id} href={f.href} title={f.last_error || undefined}>
                  {status === "processed" ? (
                    <CheckCircle2 size={12} />
                  ) : (
                    <Paperclip size={12} />
                  )}
                  {f.name}
                  {f.last_error &&
                    ` · ${t(locale, "Copia pendiente", "Copy pending")}`}
                </a>
                {f.review_source && onFileReview && (
                  <button
                    className="document-import-button"
                    type="button"
                    onClick={() => onFileReview(f)}
                  >
                    {t(
                      locale,
                      attachmentProcessingLabels[status][0],
                      attachmentProcessingLabels[status][1],
                    )}
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
      {!!legacyAttachments.length && (
        <div className="cw-message-files">
          {legacyAttachments.map((a) => {
            const doc = data.demo
              ? data.documents.find((d) => d.id === a.imported_document_id)
              : undefined;
            const status =
              a.processing_status ||
              (doc?.reviewed_at
                ? doc.status === "correction"
                  ? "correction"
                  : "processed"
                : a.imported_document_id
                  ? "linked"
                  : "pending");
            return (
              <button
                key={a.id}
                className={`cw-attachment ${status}`}
                type="button"
                disabled={!onAttachment}
                onClick={() => onAttachment?.(a)}
              >
                {status === "processed" ? (
                  <CheckCircle2 size={12} />
                ) : (
                  <Paperclip size={12} />
                )}
                {a.name} ·{" "}
                {t(
                  locale,
                  attachmentProcessingLabels[status][0],
                  attachmentProcessingLabels[status][1],
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
