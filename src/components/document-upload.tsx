"use client";
import { useEffect, useRef, useState } from "react";
import type { Document, Locale } from "@/lib/domain";
import { DocumentIntake } from "./document-intake";
import { GmailPdfPreview } from "./gmail-pdf-preview";
import { previewMime } from "@/lib/document-review";
import { t } from "./ui";
import type { Action } from "./crm";
export function DocumentUpload({
  opportunityId,
  documents,
  locale,
  demo,
  act,
  refresh,
  close,
}: {
  opportunityId: string;
  documents: Document[];
  locale: Locale;
  demo: boolean;
  act: Action;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [url, setUrl] = useState(""),
    [mime, setMime] = useState(""),
    [hash, setHash] = useState(""),
    [error, setError] = useState(""),
    [sourceId, setSourceId] = useState("");
  const keys = useRef(new Map<string, string>());
  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  const receive: Action = async (kind, p) => {
    if (demo) {
      await act("receive_upload_demo", { ...p, filename: file?.name });
      return;
    }
    const fingerprint = JSON.stringify(p),
      key = keys.current.get(fingerprint) || crypto.randomUUID();
    keys.current.set(fingerprint, key);
    const form = new FormData();
    form.set("file", file!);
    form.set("payload", JSON.stringify(p));
    form.set("request_key", key);
    const response = await fetch("/api/documents/receive-upload", {
      method: "POST",
      body: form,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    keys.current.delete(fingerprint);
    await refresh();
    return value.result;
  };
  return (
    <div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <label className="field">
        {t(
          locale,
          "Selecciona un archivo PDF, JPG o PNG (máximo 20 MB)",
          "Select a PDF, JPG or PNG file (up to 20 MB)",
        )}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={async (e) => {
            const selected = e.target.files?.[0];
            setFile(null);
            setHash("");
            setError("");
            if (!selected) return;
            if (!selected.size || selected.size > 20 * 1024 * 1024) {
              setError(
                t(
                  locale,
                  "El archivo debe pesar entre 1 byte y 20 MB.",
                  "File size must be between 1 byte and 20 MB.",
                ),
              );
              return;
            }
            const bytes = await selected.arrayBuffer(),
              type = previewMime(new Uint8Array(bytes));
            if (!type) {
              setError(
                t(locale, "Formato no admitido.", "Unsupported file type."),
              );
              return;
            }
            setMime(type);
            setHash(
              Array.from(
                new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
              )
                .map((b) => b.toString(16).padStart(2, "0"))
                .join(""),
            );
            setSourceId(crypto.randomUUID());
            setFile(selected);
          }}
        />
      </label>
      {file && url && (
        <div className="document-review-layout">
          <div className="document-review-preview">
            {mime === "application/pdf" ? (
              <GmailPdfPreview url={url} name={file.name} locale={locale} />
            ) : (
              <img src={url} alt={file.name} />
            )}
          </div>
          <DocumentIntake
            key={sourceId}
            selection={{ source: "upload", id: sourceId }}
            opportunityId={opportunityId}
            documents={documents}
            filename={file.name}
            previewHash={hash}
            previewReady={!!hash}
            editable
            demo={demo}
            uploadFile={file}
            locale={locale}
            act={receive}
            close={close}
          />
        </div>
      )}
    </div>
  );
}
