"use client";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/domain";
import type { FlowProgress } from "@/lib/campaign-flow";
import { t } from "../ui";
import "./campaign-flow.css";
export function CampaignSequence({
  id,
  locale,
  revision,
}: {
  id: string;
  locale: Locale;
  revision: number;
}) {
  const [progress, setProgress] = useState<FlowProgress | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/campaigns/flow?campaign=${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        return b;
      })
      .then((r) => {
        if (!abort.signal.aborted) {
          setProgress(r);
          setError("");
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [id, revision]);
  if (error)
    return (
      <p role="alert" className="pos-alert">
        {error}
      </p>
    );
  if (!progress) return null;
  return (
    <section className="cc-surface">
      <div className="cc-section-head">
        <div>
          <h3>
            {t(
              locale,
              "Primer envío y recordatorios",
              "Initial send and reminders",
            )}
          </h3>
          <p>
            {t(
              locale,
              "Un contacto por paso. Los recordatorios paran al responder, darse de baja o rebotar.",
              "One contact per step. Reminders stop after a reply, opt-out or bounce.",
            )}
          </p>
        </div>
      </div>
      <div className="cf-sequence">
        {progress.steps.map((s) => (
          <article key={s.step}>
            <span>
              {s.step === 0
                ? t(locale, "Primer correo", "Initial email")
                : t(locale, `Recordatorio ${s.step}`, `Reminder ${s.step}`)}
            </span>
            <strong>{s.sent}</strong>
            <small>
              {t(locale, "envíos confirmados", "confirmed sends")} · {s.waiting}{" "}
              {t(locale, "en espera", "waiting")}
            </small>
            {s.next_at && s.waiting > 0 && (
              <small>
                {t(locale, "Próximo", "Next")}:{" "}
                {new Date(s.next_at).toLocaleString(
                  locale === "es" ? "es-CO" : "en-US",
                )}
              </small>
            )}
          </article>
        ))}
      </div>
      <p className="cc-note">
        {progress.bounced} {t(locale, "rebotes", "bounces")} ·{" "}
        {progress.stopped}{" "}
        {t(locale, "secuencias detenidas", "stopped sequences")}.{" "}
        {t(
          locale,
          "La aceptación por Gmail no confirma entrega ni apertura.",
          "Gmail acceptance does not confirm delivery or opening.",
        )}
      </p>
    </section>
  );
}
