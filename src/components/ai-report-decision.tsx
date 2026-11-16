"use client";
import "./pipeline-os/case-flow-controls.css";
import { useState } from "react";
import type { Locale } from "@/lib/domain";
import { t } from "./ui";
import { ProtectedForm } from "./unsaved-changes";

export function AiReportDecision({
  status,
  locale,
  busy,
  decide,
}: {
  status: string;
  locale: Locale;
  busy: boolean;
  decide(decision: "approved" | "rejected", reason: string): Promise<void>;
}) {
  const [correcting, setCorrecting] = useState(false),
    [reason, setReason] = useState("");
  if (!["draft", "approved"].includes(status)) return null;
  return (
    <div className="ai-report-decision">
      {status === "draft" ? (
        <>
          <p className="muted">
            {t(
              locale,
              "Al aprobar confirmas que revisaste este informe de IA. No necesitas registrarlo de nuevo.",
              "Approval confirms you reviewed this AI report. No separate review record is needed.",
            )}
          </p>
          <div className="card-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void decide("approved", "")}
            >
              {t(locale, "Aprobar", "Approve")}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void decide("rejected", "")}
            >
              {t(locale, "No aprobar", "Do not approve")}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => setCorrecting((v) => !v)}
        >
          {t(locale, "Corregir aprobación", "Correct approval")}
        </button>
      )}
      {correcting && (
        <ProtectedForm
          busy={busy}
          onSubmit={async (e) => {
            e.preventDefault();
            await decide("rejected", reason);
          }}
        >
          <label className="field">
            {t(locale, "Motivo de la corrección", "Correction reason")}
            <textarea
              required
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button className="button" disabled={busy || !reason.trim()}>
            {t(locale, "Dejar como no aprobado", "Mark as not approved")}
          </button>
        </ProtectedForm>
      )}
    </div>
  );
}
