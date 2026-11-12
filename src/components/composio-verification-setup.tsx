"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Locale } from "@/lib/domain";
import {
  verificationSetupPageSchema,
  verificationSetupResultSchema,
  verificationSetupErrorText,
  type VerificationSetupPage,
  type VerificationSetupCommand,
} from "@/lib/composio-verification-setup";
import { Modal, t } from "./ui";

type Props = {
  account: string;
  locale: Locale;
  allowed: boolean;
  demo?: boolean;
  disabled?: boolean;
  onLockChange(locked: boolean): void;
  reviewAction(action: () => void): void;
  onChanged(): void;
};
export function ComposioVerificationSetup({
  account,
  locale,
  allowed,
  demo,
  disabled,
  onLockChange,
  reviewAction,
  onChanged,
}: Props) {
  const [page, setPage] = useState<VerificationSetupPage | null>(null),
    [hidden, setHidden] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [intent, setIntent] = useState<VerificationSetupCommand | null>(null);
  const generation = useRef(0),
    submitting = useRef(false),
    retry = useRef<{
      fingerprint: string;
      body: VerificationSetupCommand;
    } | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const heading = useId(),
    tr = (es: string, en: string) => t(locale, es, en);
  const endpoint = `/api/mail/accounts/${encodeURIComponent(account)}/composio/verification-setup`;
  const errorText = (e: unknown) =>
    verificationSetupErrorText(
      e && typeof e === "object" && "code" in e ? e.code : undefined,
      locale,
    );
  async function load() {
    const g = ++generation.current;
    setLoading(true);
    setError("");
    setPage(null);
    setHidden(false);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (response.status === 404) {
        if (g === generation.current) setHidden(true);
        return;
      }
      const body = await response.json();
      if (!response.ok) throw body;
      const value = verificationSetupPageSchema.parse(body);
      if (value.account_id !== account) throw Error();
      if (g === generation.current) setPage(value);
    } catch (e) {
      if (g === generation.current) setError(errorText(e));
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    retry.current = null;
    setIntent(null);
    setNotice("");
    if (allowed && !demo && account) void load();
    return () => {
      generation.current++;
    };
  }, [account, allowed, demo]);
  useEffect(() => {
    onLockChange(!!intent || busy);
    return () => onLockChange(false);
  }, [intent, busy, onLockChange]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error, intent]);
  function prepare(action: VerificationSetupCommand["action"]) {
    if (!page || page.account_id !== account || busy || disabled || loading)
      return;
    const fingerprint = JSON.stringify([
      account,
      page.setup_revision,
      action,
      page.candidate_id,
      action === "publish_policy" ? page.policy.expected_generation : null,
    ]);
    if (retry.current?.fingerprint !== fingerprint) {
      const common = {
        action,
        setup_revision: page.setup_revision,
        idempotency_key: crypto.randomUUID(),
      };
      const body: VerificationSetupCommand =
        action === "publish_policy"
          ? {
              ...common,
              action,
              expected_generation: page.policy.expected_generation,
              quiescent: true,
            }
          : {
              ...common,
              action,
              binding_id: page.candidate_id!,
              included_confirmed: true,
              expires_at: new Date(Date.now() + 600000).toISOString(),
            };
      retry.current = { fingerprint, body };
    }
    setConfirmed(false);
    setError("");
    setNotice("");
    setIntent(retry.current.body);
  }
  async function execute() {
    if (
      !intent ||
      !confirmed ||
      disabled ||
      submitting.current ||
      !page ||
      page.account_id !== account
    )
      return;
    if (
      intent.action === "grant_budget" &&
      Date.parse(intent.expires_at) <= Date.now()
    ) {
      setError(
        tr(
          "La intención caducó. Cierra y actualiza la revisión.",
          "This intent expired. Close and refresh the review.",
        ),
      );
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent),
      });
      const data = await response.json();
      if (!response.ok) throw data;
      const result = verificationSetupResultSchema.parse(data);
      if (result.action !== intent.action) throw Error();
      retry.current = null;
      setIntent(null);
      setConfirmed(false);
      setNotice(
        tr(
          "Preparación guardada. Comprobar permisos sigue siendo una acción separada.",
          "Setup saved. Checking permissions remains a separate action.",
        ),
      );
      onChanged();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  function refresh() {
    // A new intent may be prepared only after an explicit refresh of an expired one.
    if (
      retry.current?.body.action === "grant_budget" &&
      Date.parse(retry.current.body.expires_at) <= Date.now()
    )
      retry.current = null;
    void load();
  }
  if (!allowed || demo || !account || hidden) return null;
  const current = page?.account_id === account ? page : null;
  return (
    <section
      aria-labelledby={heading}
      aria-busy={loading || busy}
      style={{ minWidth: 0, marginBlock: 20 }}
    >
      <h3 id={heading}>
        {tr("Preparar comprobación limitada", "Prepare limited verification")}
      </h3>
      <p>
        {tr(
          "Estos controles no consultan Composio ni envían correos. Gmail directo se conserva.",
          "These controls do not call Composio or send emails. Direct Gmail is preserved.",
        )}
      </p>
      {loading && (
        <p role="status">{tr("Cargando preparación…", "Loading setup…")}</p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && !intent && (
        <p role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      )}
      {current && (
        <>
          <p>
            {tr("Política compartida", "Shared policy")}:{" "}
            {current.policy.ready
              ? tr("Lista", "Ready")
              : tr("Pendiente", "Pending")}{" "}
            · {tr("Generación", "Generation")}{" "}
            {current.policy.expected_generation} →{" "}
            {current.policy.proposed_generation}
          </p>
          <p>
            {tr("Límite por minuto", "Limit per minute")}:{" "}
            {current.policy.limits.group_units_per_minute.toLocaleString(
              locale,
            )}{" "}
            {tr(
              "unidades compartidas; puede ralentizar también Gmail directo.",
              "shared units; direct Gmail may also slow down.",
            )}
          </p>
          <p>
            {current.verification_available
              ? tr(
                  "Presupuesto disponible. Usa Comprobar permisos cuando esté autorizado.",
                  "Budget available. Use Check permissions when authorized.",
                )
              : tr(
                  "Presupuesto: 4 consultas, de ellas 2 de proxy. Caduca como máximo en 10 minutos desde la revisión de la acción.",
                  "Budget: 4 requests, including 2 proxy requests. Expires within 10 minutes of reviewing the action.",
                )}
          </p>
          {!current.checks_enabled && (
            <p>
              {tr(
                "El servidor mantiene deshabilitada la comprobación. No se puede conceder presupuesto todavía.",
                "Verification remains disabled on the server. A budget cannot be granted yet.",
              )}
            </p>
          )}
          <div
            className="button-row"
            style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
          >
            <button
              type="button"
              className="button"
              disabled={
                disabled ||
                busy ||
                loading ||
                !!intent ||
                !current.policy.can_publish
              }
              onClick={() => reviewAction(() => prepare("publish_policy"))}
            >
              {tr("Revisar política", "Review policy")}
            </button>
            <button
              type="button"
              className="button"
              disabled={
                disabled ||
                busy ||
                loading ||
                !!intent ||
                !current.can_grant ||
                !current.checks_enabled ||
                current.verification_available
              }
              onClick={() => reviewAction(() => prepare("grant_budget"))}
            >
              {tr("Autorizar cuatro consultas", "Authorize four requests")}
            </button>
          </div>
        </>
      )}
      <button
        type="button"
        className="button"
        disabled={disabled || busy || loading || !!intent}
        onClick={() => reviewAction(refresh)}
      >
        {tr("Actualizar preparación", "Refresh setup")}
      </button>
      {intent && (
        <Modal
          locale={locale}
          title={
            intent.action === "publish_policy"
              ? tr("Confirmar política", "Confirm policy")
              : tr("Confirmar presupuesto", "Confirm budget")
          }
          busy={busy}
          close={() => {
            if (!busy) setIntent(null);
          }}
        >
          <p>
            {intent.action === "publish_policy"
              ? tr(
                  "Publica los límites compartidos revisados y conserva el consumo registrado. Requiere la pausa operativa de todos los escritores y sincronizaciones.",
                  "Publish the reviewed shared limits and preserve recorded usage. All writers and synchronizations must be paused.",
                )
              : tr(
                  "Autoriza únicamente cuatro consultas del verificador. Confirma al menos dos llamadas proxy incluidas disponibles en el ciclo actual y ningún costo adicional.",
                  "Authorize only four verifier requests. Confirm at least two included proxy calls available in the current cycle and no additional cost.",
                )}
          </p>
          {intent.action === "grant_budget" && (
            <p>
              {tr("Caduca", "Expires")}:{" "}
              <time dateTime={intent.expires_at}>
                {new Date(intent.expires_at).toLocaleTimeString(locale)}
              </time>
            </p>
          )}
          <label
            className="field"
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "start",
              gap: 12,
            }}
          >
            <input
              type="checkbox"
              style={{ width: "auto", flexShrink: 0, marginTop: 4 }}
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {intent.action === "publish_policy"
              ? tr(
                  "Confirmo la pausa operativa completa.",
                  "I confirm the complete operational pause.",
                )
              : tr(
                  "Confirmo el cupo incluido y costo adicional cero.",
                  "I confirm included quota and zero additional cost.",
                )}
          </label>
          {error && (
            <p role="alert" tabIndex={-1} ref={errorRef}>
              {error}
            </p>
          )}
          <button
            type="button"
            className="button"
            disabled={busy || !confirmed || disabled}
            onClick={() => void execute()}
          >
            {busy
              ? tr("Guardando…", "Saving…")
              : tr("Confirmar preparación", "Confirm setup")}
          </button>
        </Modal>
      )}
    </section>
  );
}
