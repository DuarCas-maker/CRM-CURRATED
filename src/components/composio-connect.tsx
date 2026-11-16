"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Locale } from "@/lib/domain";
import {
  connectBeginHttp,
  connectOptionsHttp,
  connectViewHttp,
  connectReturnAttempt,
  connectAttemptHref,
  type ConnectHttpOptions,
  type ConnectHttpView,
} from "@/lib/composio-connect-http";
import { ProtectedForm } from "./unsaved-changes";
import { t } from "./ui";
type Account = { id: string; email: string };
const labels: Record<string, [string, string]> = {
  prepared: ["Intento preparado", "Attempt prepared"],
  link_pending: ["Preparando autorización", "Preparing authorization"],
  awaiting_consent: [
    "Esperando autorización en Google",
    "Waiting for Google authorization",
  ],
  identity_checking: ["Comprobando identidad", "Checking identity"],
  awaiting_brand: ["Marca pendiente de revisión", "Brand review pending"],
  ready_to_register: [
    "Listo para registrar candidato",
    "Ready to register candidate",
  ],
  completed: [
    "Candidato registrado; transporte sin activar",
    "Candidate registered; transport not activated",
  ],
  cancelled: ["Intento cancelado", "Attempt cancelled"],
  expired: ["Intento caducado", "Attempt expired"],
  rejected: [
    "Identidad o autorización rechazada",
    "Identity or authorization rejected",
  ],
  uncertain: [
    "Resultado incierto; requiere conciliación",
    "Uncertain result; reconciliation required",
  ],
};
type Draft = {
  mode: "new" | "existing" | "reconnect";
  account_id: string;
  brand_id: string;
  email: string;
  organization: string;
};
type ViewProps = {
  locale: Locale;
  accounts: Account[];
  options: ConnectHttpOptions | null;
  view: ConnectHttpView | null;
  attempt: string;
  draft: Draft;
  busy: boolean;
  error: string;
  onDraft(d: Draft): void;
  onOptions(): void;
  onMore(): void;
  onBegin(): void;
  onStatus(): void;
  onAction(a: "start" | "cancel" | "register" | "adopt"): void;
  onNew(): void;
};
export function ComposioConnectView(p: ViewProps) {
  const title = useId(),
    { locale, view, options, draft } = p,
    status = view?.status,
    expired = status?.expired;
  return (
    <section
      className="panel settings-panel"
      aria-labelledby={title}
      aria-busy={p.busy}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h2 id={title}>
        {t(
          locale,
          "Conectar Gmail con Composio",
          "Connect Gmail with Composio",
        )}
      </h2>
      <p>
        {t(
          locale,
          "Conecta una cuenta por intento desde tu sesión con MFA. El consentimiento crea un candidato; la revisión de marca, los permisos y el transporte se aprueban por separado.",
          "Connect one account per attempt from your MFA session. Consent creates a candidate; brand review, permissions and transport are approved separately.",
        )}
      </p>
      {!p.attempt && (
        <button className="button" disabled={p.busy} onClick={p.onOptions}>
          {t(
            locale,
            "Revisar disponibilidad y contexto",
            "Review availability and context",
          )}
        </button>
      )}
      {options && !options.enabled && (
        <p role="status">
          {t(
            locale,
            "El alta con Composio no está habilitada. Gmail directo conserva su configuración.",
            "Composio onboarding is not enabled. Direct Gmail retains its configuration.",
          )}
        </p>
      )}
      {options?.enabled && !p.attempt && (
        <ProtectedForm
          busy={p.busy}
          onSubmit={(e) => {
            e.preventDefault();
            p.onBegin();
          }}
        >
          <div className="form-grid">
            <label className="field">
              {t(locale, "Tipo de conexión", "Connection type")}
              <select
                value={draft.mode}
                onChange={(e) =>
                  p.onDraft({
                    ...draft,
                    mode: e.target.value as Draft["mode"],
                    account_id: "",
                  })
                }
              >
                <option value="new">
                  {t(locale, "Cuenta nueva en CRM", "New CRM account")}
                </option>
                <option value="existing">
                  {t(
                    locale,
                    "Asociar cuenta existente",
                    "Link existing account",
                  )}
                </option>
                <option value="reconnect">
                  {t(
                    locale,
                    "Reconectar por decisión explícita",
                    "Explicit reconnection",
                  )}
                </option>
              </select>
            </label>
            {draft.mode !== "new" ? (
              <label className="field">
                {t(locale, "Cuenta que vas a conectar", "Account to connect")}
                <select
                  required
                  value={draft.account_id}
                  onChange={(e) =>
                    p.onDraft({ ...draft, account_id: e.target.value })
                  }
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
            ) : (
              <>
                <label className="field">
                  {t(locale, "Correo Gmail esperado", "Expected Gmail address")}
                  <input
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="off"
                    value={draft.email}
                    onChange={(e) =>
                      p.onDraft({ ...draft, email: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  {t(locale, "Organización del CRM", "CRM organization")}
                  <select
                    required
                    value={draft.organization}
                    onChange={(e) =>
                      p.onDraft({ ...draft, organization: e.target.value })
                    }
                  >
                    <option value="">
                      {t(
                        locale,
                        "Selecciona una organización",
                        "Select an organization",
                      )}
                    </option>
                    {options.organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label className="field">
              {t(locale, "Marca que se revisará", "Brand to review")}
              <select
                required
                value={draft.brand_id}
                onChange={(e) =>
                  p.onDraft({ ...draft, brand_id: e.target.value })
                }
              >
                <option value="">
                  {t(locale, "Selecciona una marca", "Select a brand")}
                </option>
                {options.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {draft.mode !== "new" &&
            (!options.account || options.account.id !== draft.account_id) && (
              <p>
                {t(
                  locale,
                  "Selecciona la cuenta y vuelve a revisar el contexto antes de preparar.",
                  "Select the account and review its context again before preparing.",
                )}
              </p>
            )}
          {options.next_cursor && (
            <button
              className="button"
              type="button"
              onClick={p.onMore}
              disabled={p.busy}
            >
              {t(locale, "Cargar más marcas", "Load more brands")}
            </button>
          )}
          <p>
            {t(
              locale,
              "Selecciona exactamente este correo cuando Google lo solicite. Preparar el intento todavía no crea un enlace.",
              "Select this exact address when Google asks. Preparing the attempt does not create a link yet.",
            )}{" "}
            <strong>
              {draft.mode === "new" ? draft.email : options.account?.email}
            </strong>
          </p>
          <button
            className="button primary"
            disabled={
              p.busy ||
              !draft.brand_id ||
              (draft.mode !== "new" && options.account?.id !== draft.account_id)
            }
          >
            {t(
              locale,
              "Preparar conexión revisada",
              "Prepare reviewed connection",
            )}
          </button>
        </ProtectedForm>
      )}
      {p.attempt && (
        <div className="card-actions">
          <button className="button" disabled={p.busy} onClick={p.onStatus}>
            {t(locale, "Revisar intento", "Review attempt")}
          </button>
        </div>
      )}
      {p.error && (
        <p role="alert" tabIndex={-1}>
          {p.error}
        </p>
      )}
      <div role="status" aria-live="polite">
        {status && (
          <>
            <h3>
              {expired
                ? t(locale, ...labels.expired)
                : t(locale, ...labels[status.state])}
            </h3>
            <p>
              {t(locale, "Vigente hasta", "Valid until")}:{" "}
              {new Date(status.deadline_ms).toLocaleString(
                locale === "es" ? "es-CO" : "en-US",
              )}
            </p>
            <p>{status.expected_mailbox_email}</p>
          </>
        )}
        {view?.context_changed && (
          <p>
            {t(
              locale,
              "El contexto de marca cambió. Revisa su asociación en Administración de marcas; adoptar vuelve a comprobarla en el servidor.",
              "The brand context changed. Review its association in Brand administration; adoption rechecks it on the server.",
            )}
          </p>
        )}
        {(status?.state === "awaiting_brand" || view?.pending) && (
          <p>
            {t(
              locale,
              "Confirma primero la asociación en Administración de marcas, en esta misma página. Después pulsa Adoptar revisión confirmada. Este botón no aprueba la marca por ti.",
              "First confirm the association in Brand administration on this page. Then choose Adopt confirmed review. This button does not approve the brand for you.",
            )}
          </p>
        )}
        {status?.state === "uncertain" && (
          <p>
            {t(
              locale,
              "No crees otro enlace para resolver este resultado. Requiere conciliación del intento.",
              "Do not create another link to resolve this result. The attempt requires reconciliation.",
            )}
          </p>
        )}
      </div>
      {p.attempt && !expired && (
        <div className="card-actions">
          {status?.next === "authorize" && (
            <button
              className="button primary"
              disabled={p.busy}
              onClick={() => p.onAction("start")}
            >
              {t(
                locale,
                "Crear autorización para este correo",
                "Create authorization for this account",
              )}
            </button>
          )}
          {status?.next === "resume" && (
            <form
              method="post"
              action={`/api/mail/composio/connect/${encodeURIComponent(p.attempt)}/resume`}
            >
              <button className="button primary" disabled={p.busy}>
                {t(
                  locale,
                  "Autorizar en Google / Retomar",
                  "Authorize with Google / Resume",
                )}
              </button>
            </form>
          )}
          {view?.pending && (
            <button
              className="button primary"
              disabled={p.busy}
              onClick={() => p.onAction("adopt")}
            >
              {t(
                locale,
                "Adoptar revisión confirmada",
                "Adopt confirmed review",
              )}
            </button>
          )}
          {status?.next === "register_candidate" && (
            <button
              className="button primary"
              disabled={p.busy}
              onClick={() => p.onAction("register")}
            >
              {t(
                locale,
                "Registrar candidato revisado",
                "Register reviewed candidate",
              )}
            </button>
          )}
          {status &&
            ![
              "completed",
              "cancelled",
              "expired",
              "rejected",
              "uncertain",
            ].includes(status.state) && (
              <button
                className="button"
                disabled={p.busy}
                onClick={() => p.onAction("cancel")}
              >
                {t(locale, "Cancelar intento", "Cancel attempt")}
              </button>
            )}
        </div>
      )}
      {p.attempt &&
        (expired ||
          (status &&
            ["completed", "cancelled", "expired", "rejected"].includes(
              status.state,
            ))) && (
          <button className="button" disabled={p.busy} onClick={p.onNew}>
            {t(locale, "Preparar otra conexión", "Prepare another connection")}
          </button>
        )}
      {p.attempt && !status && p.error && (
        <button className="button" disabled={p.busy} onClick={p.onNew}>
          {t(locale, "Volver al formulario", "Back to connection form")}
        </button>
      )}
    </section>
  );
}
export function ComposioConnect({
  locale,
  allowed,
  demo,
  accounts,
}: {
  locale: Locale;
  allowed: boolean;
  demo: boolean;
  accounts: Account[];
}) {
  const [options, setOptions] = useState<ConnectHttpOptions | null>(null),
    [view, setView] = useState<ConnectHttpView | null>(null),
    [attempt, setAttempt] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<Draft>({
      mode: "new",
      account_id: "",
      brand_id: "",
      email: "",
      organization: "",
    });
  const generation = useRef(0),
    abort = useRef<AbortController | null>(null),
    keys = useRef(new Map<string, string>());
  useEffect(() => {
    if (allowed && !demo) {
      const id = connectReturnAttempt(
        new URLSearchParams(window.location.search),
      );
      if (id) {
        setAttempt(id);
        void status(id);
      }
    }
    return () => {
      generation.current++;
      abort.current?.abort();
    };
  }, [allowed, demo]);
  if (!allowed || demo) return null;
  const text = (code: string) =>
    code === "CONNECT_NEEDS_RECONCILIATION"
      ? t(
          locale,
          "Resultado incierto; requiere conciliación. No se reintentó el proveedor.",
          "Uncertain result; reconciliation required. No provider retry was made.",
        )
      : code === "CONNECT_FORBIDDEN"
        ? t(
            locale,
            "Revisa tu sesión original y MFA.",
            "Check your original session and MFA.",
          )
        : code === "CONNECT_IDENTITY_MISMATCH"
          ? t(
              locale,
              "El Gmail autorizado no coincide con el esperado.",
              "The authorized Gmail does not match the expected account.",
            )
          : code === "CONNECT_CONFLICT"
            ? t(
                locale,
                "Ya hay un intento o una cuenta para este correo. Retoma el intento original o revisa el tipo de conexión antes de preparar otro.",
                "An attempt or account already exists for this address. Resume the original attempt or review the connection type before preparing another.",
              )
            : code === "CONNECT_STALE"
              ? t(
                  locale,
                  "El contexto cambió. Vuelve a revisar disponibilidad, cuenta y marca antes de continuar.",
                  "The context changed. Review availability, account and brand again before continuing.",
                )
              : code === "CONNECT_CLOSED"
                ? t(
                    locale,
                    "El intento venció. Revisa el estado y vuelve al formulario si deseas iniciar otro.",
                    "The attempt expired. Review its status and return to the form if you want to start another.",
                  )
                : t(
                    locale,
                    "No se confirmó la operación. Revisa el contexto y el estado antes de continuar.",
                    "The operation was not confirmed. Review the context and status before continuing.",
                  );
  const key = (value: unknown) => {
    const k = JSON.stringify(value);
    let id = keys.current.get(k);
    if (!id) {
      id = crypto.randomUUID();
      keys.current.set(k, id);
    }
    return id;
  };
  async function readOptions(more = false) {
    const gen = ++generation.current;
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    setBusy(true);
    setError("");
    try {
      const q = new URLSearchParams();
      if (draft.mode !== "new" && draft.account_id)
        q.set("account_id", draft.account_id);
      if (more && options?.next_cursor) q.set("cursor", options.next_cursor);
      const response = await fetch(
        "/api/mail/composio/connect" + (q.size ? "?" + q : ""),
        { cache: "no-store", signal: c.signal },
      );
      if (!response.ok) throw Error("CONNECT_UNAVAILABLE");
      const value = connectOptionsHttp.parse(await response.json());
      if (gen === generation.current)
        setOptions(
          more && options
            ? {
                ...value,
                brands: [
                  ...new Map(
                    [...options.brands, ...value.brands].map((b) => [b.id, b]),
                  ).values(),
                ],
              }
            : value,
        );
    } catch {
      if (gen === generation.current) {
        setOptions(null);
        setError(text("CONNECT_UNAVAILABLE"));
      }
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }
  async function status(currentAttempt = attempt) {
    if (!currentAttempt) return;
    const gen = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        `/api/mail/composio/connect/${encodeURIComponent(currentAttempt)}`,
        { cache: "no-store" },
      );
      if (!r.ok) {
        const error = await r.json();
        throw Error(error.code);
      }
      const result = connectViewHttp.parse(await r.json());
      if (gen === generation.current) setView(result);
    } catch (e) {
      if (gen === generation.current)
        setError(text(e instanceof Error ? e.message : ""));
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }
  async function begin() {
    if (!options || !draft.brand_id) return;
    const brand = options.brands.find((b) => b.id === draft.brand_id);
    if (!brand) return;
    const input = {
      mode: draft.mode,
      brand_id: brand.id,
      expected_brand_revision: brand.revision,
      expected_account_revision:
        draft.mode === "new" ? 0 : options.account?.account_revision,
      expected_head_revision:
        draft.mode === "new" ? 0 : options.account?.head_revision,
      expected_config_generation: options.generation,
      ...(draft.mode === "new"
        ? {
            email: draft.email.trim().toLowerCase(),
            organization: draft.organization,
          }
        : { account_id: draft.account_id }),
    };
    const body = connectBeginHttp.safeParse({
      ...input,
      idempotency_key: key(input),
    });
    if (!body.success) {
      setError(
        t(
          locale,
          "Completa el correo, marca y contexto revisados.",
          "Complete the reviewed email, brand and context.",
        ),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/mail/composio/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body.data),
        cache: "no-store",
      });
      if (!r.ok) {
        const e = await r.json();
        throw Error(e.code);
      }
      const result = connectViewHttp.parse(await r.json());
      if (!result.status) throw Error();
      setAttempt(result.status.id);
      setView(result);
      window.history.replaceState(
        window.history.state,
        "",
        connectAttemptHref(window.location.href, result.status.id),
      );
    } catch (e) {
      setError(text(e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
    }
  }
  async function action(kind: "start" | "cancel" | "register" | "adopt") {
    const revision = view?.status?.revision ?? view?.pending?.expected_revision;
    if (revision === undefined) return;
    setBusy(true);
    setError("");
    const body = {
      ...(kind === "adopt" ? {} : { expected_revision: revision }),
      idempotency_key: key([attempt, kind, revision, view?.pending]),
    };
    try {
      const r = await fetch(
        `/api/mail/composio/connect/${encodeURIComponent(attempt)}/${kind}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        },
      );
      if (!r.ok) {
        const e = await r.json();
        throw Error(e.code);
      }
      setView(connectViewHttp.parse(await r.json()));
    } catch (e) {
      setError(text(e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
    }
  }
  function change(next: Draft) {
    generation.current++;
    abort.current?.abort();
    setBusy(false);
    setDraft(next);
    setError("");
    if (next.mode !== draft.mode || next.account_id !== draft.account_id)
      setOptions((o) => (o ? { ...o, account: null } : null));
  }
  return (
    <ComposioConnectView
      {...{ locale, accounts, options, view, attempt, draft, busy, error }}
      onDraft={change}
      onOptions={() => void readOptions()}
      onMore={() => void readOptions(true)}
      onBegin={() => void begin()}
      onStatus={() => void status()}
      onAction={(a) => void action(a)}
      onNew={() => {
        generation.current++;
        keys.current.clear();
        window.history.replaceState(
          window.history.state,
          "",
          connectAttemptHref(window.location.href, null),
        );
        setAttempt("");
        setView(null);
        setError("");
        setOptions(null);
      }}
    />
  );
}
