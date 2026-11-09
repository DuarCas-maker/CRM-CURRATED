"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Locale } from "@/lib/domain";
import {
  transportReview,
  type TransportReview,
  type TransportCommand,
  transportPage,
} from "@/lib/mail-transport-selection";
import { Modal, t } from "./ui";
type Account = { id: string; email: string };
type Choice = {
  kind: TransportCommand["kind"];
  target: "gmail_oauth" | "composio";
  label: string;
};
export function transportChoices(
  review: TransportReview,
  locale: Locale,
): Choice[] {
  const r = review.selection,
    out: Choice[] = [];
  if (!r || r.revision === 0) {
    if (review.eligible_direct)
      out.push({
        kind: "bootstrap_direct",
        target: "gmail_oauth",
        label: t(locale, "Seleccionar Gmail directo", "Select direct Gmail"),
      });
    return out;
  }
  if (r.state !== "paused")
    out.push({
      kind: "pause",
      target: r.provider,
      label: t(locale, "Pausar transporte", "Pause transport"),
    });
  if (r.state === "draining") {
    out.push({
      kind: "cancel_transition",
      target: r.provider,
      label: t(locale, "Cancelar transición", "Cancel transition"),
    });
    if (
      !review.unresolved &&
      ((r.target_provider === "gmail_oauth" && review.eligible_direct) ||
        (r.target_provider === "composio" && review.composio_enabled))
    )
      out.push({
        kind: "commit_transition",
        target: r.target_provider!,
        label: t(
          locale,
          "Confirmar cambio revisado",
          "Confirm reviewed switch",
        ),
      });
  } else {
    if (review.eligible_direct)
      out.push({
        kind: "prepare_transition",
        target: "gmail_oauth",
        label: t(locale, "Preparar Gmail directo", "Prepare direct Gmail"),
      });
    if (review.composio_enabled && review.binding_verified)
      out.push({
        kind: "prepare_transition",
        target: "composio",
        label: t(locale, "Preparar Composio", "Prepare Composio"),
      });
  }
  return out;
}
type ViewProps = {
  locale: Locale;
  accounts: Account[];
  account: string;
  review: TransportReview | null;
  busy: boolean;
  loading: boolean;
  error: string;
  fresh: boolean;
  onAccount(id: string): void;
  onRefresh(): void;
  onChoose(choice: Choice): void;
};
export function MailTransportSettingsView(p: ViewProps) {
  const id = useId(),
    { locale, review } = p;
  const r = review?.selection;
  const state = r
    ? {
        paused: t(locale, "Pausado", "Paused"),
        draining: t(locale, "En transición", "Draining"),
        ready: t(locale, "Seleccionado", "Selected"),
      }[r.state]
    : t(locale, "Sin selección", "No selection");
  return (
    <section
      className="panel settings-panel"
      aria-labelledby={id}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h2 id={id}>
        {t(locale, "Transporte de cada cuenta", "Account transport")}
      </h2>
      <p>
        {t(
          locale,
          "Revisa por separado la asociación, el transporte seleccionado y la recepción. Cambiar el transporte no concede permisos ni reanuda campañas.",
          "Review the binding, selected transport and reception separately. Switching transport grants no permissions and resumes no campaigns.",
        )}
      </p>
      <label className="field">
        {t(locale, "Cuenta de correo", "Mail account")}
        <select
          value={p.account}
          disabled={p.busy}
          onChange={(e) => p.onAccount(e.target.value)}
          style={{ maxWidth: "100%" }}
        >
          <option value="">
            {t(locale, "Selecciona una cuenta", "Select an account")}
          </option>
          {p.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email}
            </option>
          ))}
        </select>
      </label>
      <div className="card-actions">
        <button
          className="button"
          disabled={!p.account || p.busy || p.loading}
          onClick={p.onRefresh}
        >
          {t(locale, "Revisar estado", "Review status")}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {p.loading && (
          <p>{t(locale, "Consultando estado…", "Loading status…")}</p>
        )}
      </div>
      {p.error && <p role="alert">{p.error}</p>}
      {review && (
        <>
          <dl>
            <dt>{t(locale, "Asociación Composio", "Composio binding")}</dt>
            <dd>
              {review.binding_verified
                ? t(locale, "Verificada", "Verified")
                : t(locale, "Sin verificación vigente", "No verified binding")}
            </dd>
            <dt>{t(locale, "Transporte", "Transport")}</dt>
            <dd>
              {r
                ? `${r.provider === "gmail_oauth" ? t(locale, "Gmail directo", "Direct Gmail") : "Composio"} · ${state} · r${r.revision}`
                : state}
            </dd>
            <dt>{t(locale, "Recepción", "Reception")}</dt>
            <dd>
              {review.receive_enabled &&
              review.current &&
              !review.unresolved &&
              (r?.provider !== "composio" || review.composio_enabled)
                ? t(
                    locale,
                    "Habilitada para sincronización",
                    "Enabled for sync",
                  )
                : t(
                    locale,
                    "No habilitada para sincronización",
                    "Not enabled for sync",
                  )}
            </dd>
          </dl>
          {review.unresolved && (
            <p role="status">
              {t(
                locale,
                "Hay trabajo pendiente o incierto. Debe finalizar o conciliarse antes de confirmar un cambio de transporte.",
                "Pending or uncertain work must finish or be reconciled before confirming a transport switch.",
              )}
            </p>
          )}
          {!review.composio_enabled && (
            <p>
              {t(
                locale,
                "La operación con Composio sigue deshabilitada.",
                "Composio operation remains disabled.",
              )}
            </p>
          )}
          {r?.state === "ready" && !review.current && (
            <p role="status">
              {t(
                locale,
                "La selección requiere revisión de identidad, marca o credenciales.",
                "The selection needs an identity, brand or credential review.",
              )}
            </p>
          )}
          <div className="card-actions">
            {transportChoices(review, locale).map((c) => (
              <button
                key={c.kind + c.target}
                className="button"
                disabled={!p.fresh || p.busy || p.loading}
                onClick={() => p.onChoose(c)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}
      {!p.accounts.length && (
        <p>
          {t(locale, "No hay cuentas disponibles.", "No accounts available.")}
        </p>
      )}
    </section>
  );
}
export function MailTransportSettings({
  allowed,
  demo,
  accounts,
  locale,
}: {
  allowed: boolean;
  demo: boolean;
  accounts: Account[];
  locale: Locale;
}) {
  const [account, setAccount] = useState(""),
    [review, setReview] = useState<TransportReview | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [fresh, setFresh] = useState(false),
    [choice, setChoice] = useState<Choice | null>(null);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    keys = useRef(new Map<string, string>());
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!accounts.some((a) => a.id === account)) {
      generation.current++;
      controller.current?.abort();
      setAccount("");
      setReview(null);
      setFresh(false);
      setChoice(null);
      setBusy(false);
      setLoading(false);
    }
  }, [accounts, account]);
  if (!allowed || demo) return null;
  const endpoint = `/api/mail/accounts/${encodeURIComponent(account)}/transport`;
  function select(id: string) {
    generation.current++;
    controller.current?.abort();
    setAccount(id);
    setReview(null);
    setFresh(false);
    setChoice(null);
    setError("");
    setLoading(false);
  }
  async function refresh() {
    const gen = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setFresh(false);
    setError("");
    setReview(null);
    try {
      const response = await fetch(endpoint + "/review", {
        cache: "no-store",
        signal: abort.signal,
      });
      if (!response.ok)
        throw Error(response.status === 503 ? "disabled" : "review");
      const next = transportReview.parse(await response.json());
      if (next.selection && next.selection.account_id !== account)
        throw Error("review");
      if (gen === generation.current) {
        setReview(next);
        setFresh(true);
      }
    } catch (e) {
      if (gen === generation.current)
        setError(
          e instanceof Error && e.message === "disabled"
            ? t(
                locale,
                "Administración de transporte no habilitada. El modo existente sigue configurado en el servidor.",
                "Transport administration is not enabled. The server retains its existing mode.",
              )
            : t(
                locale,
                "No se pudo revisar. Comprueba tu sesión y MFA y vuelve a consultar.",
                "Review failed. Check your session and MFA, then review again.",
              ),
        );
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }
  async function command() {
    if (!choice || !review || !fresh || busy) return;
    const gen = ++generation.current,
      selected = choice;
    const base = {
      kind: selected.kind,
      payload: { ...review.expected, target_provider: selected.target },
    };
    const fingerprint = account + JSON.stringify(base);
    let key = keys.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(fingerprint, key);
    }
    setBusy(true);
    setFresh(false);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, idempotency_key: key }),
        cache: "no-store",
      });
      if (!response.ok) throw Error("command");
      const result = transportPage.parse(await response.json());
      if (result.account_id !== account) throw Error("command");
      if (gen === generation.current) {
        setChoice(null);
        setReview(null);
        setError(
          t(
            locale,
            "Cambio registrado. Revisa el estado antes del siguiente paso.",
            "Change recorded. Review status before the next step.",
          ),
        );
      }
    } catch {
      if (gen === generation.current) {
        setChoice(null);
        setError(
          t(
            locale,
            "Resultado no confirmado. Consulta el estado; no se reintentó automáticamente.",
            "Result not confirmed. Review status; no automatic retry was made.",
          ),
        );
      }
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }
  return (
    <>
      <MailTransportSettingsView
        {...{ locale, accounts, account, review, loading, busy, error, fresh }}
        onAccount={select}
        onRefresh={() => void refresh()}
        onChoose={setChoice}
      />
      {choice && (
        <Modal
          title={choice.label}
          locale={locale}
          busy={busy}
          close={() => {
            if (!busy) setChoice(null);
          }}
        >
          <p>
            {t(
              locale,
              "Confirma únicamente este cambio de transporte para la cuenta revisada. No activa campañas ni concede acceso a expedientes.",
              "Confirm only this transport change for the reviewed account. It activates no campaigns and grants no case access.",
            )}
          </p>
          <p style={{ overflowWrap: "anywhere" }}>
            {accounts.find((a) => a.id === account)?.email}
          </p>
          <button
            className="button primary"
            disabled={busy || !fresh}
            onClick={() => void command()}
          >
            {t(locale, "Confirmar cambio", "Confirm change")}
          </button>
        </Modal>
      )}
    </>
  );
}
