"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import type { Locale } from "@/lib/domain";
import {
  bindingExpected,
  bindingErrorText,
  bindingPageSchema,
  bindingResultSchema,
  bindingRequest,
  parseBindingCommand,
  type BindingKind,
  type BindingPage,
} from "@/lib/composio-bindings";
import {
  ProtectedForm,
  markFormSaved,
  useLeaveConfirmation,
} from "./unsaved-changes";
import { Modal, t } from "./ui";

type Account = { id: string; email: string };
type Intent = {
  account: string;
  kind: BindingKind;
  payload: Record<string, unknown>;
  key: string;
  email: string;
  brand: string | null;
};
const fields = [
  [
    "composio_project_id",
    "Proyecto Composio",
    "Composio project",
    "Identifica el proyecto de Composio; no es el proyecto Google.",
    "The Composio project, separate from the Google project.",
    128,
  ],
  [
    "auth_config_id",
    "Auth Config ID",
    "Auth Config ID",
    "Configuración OAuth de Gmail (ac_…).",
    "Gmail OAuth configuration (ac_…).",
    131,
  ],
  [
    "connected_account_id",
    "Connected Account ID",
    "Connected Account ID",
    "Conexión de este buzón (ca_…); no repitas el Auth Config ID.",
    "This mailbox connection (ca_…); not the Auth Config ID.",
    131,
  ],
  [
    "composio_user_id",
    "User ID de Composio",
    "Composio User ID",
    "Propietario técnico de la conexión; no implica un usuario o permiso del CRM.",
    "Technical connection owner; does not grant CRM user access.",
    1024,
  ],
  [
    "google_quota_project_id",
    "Proyecto de cuota Google",
    "Google quota project",
    "Proyecto del cliente OAuth revisado. No lo deduzcas del proyecto Composio.",
    "Reviewed OAuth client project. Do not infer it from the Composio project.",
    128,
  ],
] as const;
const statusLabels = {
  candidate: ["Pendiente de evidencia", "Awaiting evidence"],
  verified: ["Asociación verificada", "Verified binding"],
  blocked: ["Requiere revisión", "Needs review"],
  revoked: ["Revocada en el CRM", "Revoked in CRM"],
  superseded: ["Reemplazada", "Superseded"],
} as const;

type ViewProps = {
  locale: Locale;
  allowed: boolean;
  demo?: boolean;
  accounts: Account[];
  accountId: string;
  page: BindingPage | null;
  loading: boolean;
  busy: boolean;
  fresh: boolean;
  error: string;
  notice: string;
  formRef?: RefObject<HTMLFormElement | null>;
  errorRef?: RefObject<HTMLParagraphElement | null>;
  onAccount: (id: string) => void;
  onRefresh: () => void;
  onMore: () => void;
  onRegister: (event: FormEvent<HTMLFormElement>) => void;
  onRevoke: () => void;
};
export function ComposioAccountBindingsView(p: ViewProps) {
  const { locale, page } = p,
    fieldId = useId();
  const locked = p.loading || p.busy || !p.fresh;
  return (
    <section
      className="panel settings-panel"
      aria-labelledby={fieldId + "-title"}
      aria-busy={p.loading || p.busy}
    >
      <h2 id={fieldId + "-title"}>
        {t(locale, "Asociación Composio", "Composio binding")}
      </h2>
      <p>
        {t(
          locale,
          "Transporte activo: Gmail directo. Registrar un candidato no cambia el envío ni conecta otra cuenta.",
          "Active transport: direct Gmail. Registering a candidate does not change delivery or connect another account.",
        )}
      </p>
      {!p.allowed ? (
        <p>
          {t(
            locale,
            "Administración disponible solo para superadmin con MFA.",
            "Administration requires a superadmin with MFA.",
          )}
        </p>
      ) : (
        <>
          {p.demo && (
            <p>
              {t(
                locale,
                "Demostración: no se consultan ni guardan asociaciones reales.",
                "Demo: real bindings are neither loaded nor saved.",
              )}
            </p>
          )}
          <label className="field">
            {t(locale, "Cuenta del CRM", "CRM account")}
            <select
              value={p.accountId}
              disabled={p.busy}
              onChange={(e) => p.onAccount(e.target.value)}
            >
              <option value="">
                {t(
                  locale,
                  "Selecciona una cuenta para revisar",
                  "Select an account to review",
                )}
              </option>
              {p.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </select>
          </label>
          {!p.accounts.length && (
            <p>
              {t(
                locale,
                "No hay cuentas disponibles en este espacio.",
                "No accounts are available in this workspace.",
              )}
            </p>
          )}
          {p.loading && (
            <p role="status">
              {t(
                locale,
                "Cargando estado de asociación…",
                "Loading binding status…",
              )}
            </p>
          )}
          {p.error && (
            <p className="error" role="alert" tabIndex={-1} ref={p.errorRef}>
              {bindingErrorText(p.error, locale)}
            </p>
          )}
          {p.notice && <p role="status">{p.notice}</p>}
          {!!p.accountId && !p.demo && (
            <button
              type="button"
              className="button"
              disabled={p.busy || p.loading}
              onClick={p.onRefresh}
            >
              {t(locale, "Actualizar revisión", "Refresh revision")}
            </button>
          )}
          {page && (
            <>
              <div
                className="analysis-card"
                style={{ marginBlock: 16, overflowWrap: "anywhere" }}
              >
                <strong>{page.account.email}</strong>
                <p>
                  {t(locale, "Marca", "Brand")}:{" "}
                  {page.account.brand_name ||
                    t(locale, "Sin marca revisada", "No reviewed brand")}
                </p>
                <p>
                  {t(locale, "Revisión técnica", "Technical revision")}:{" "}
                  {page.head_revision}
                </p>
                {!page.account.ready && (
                  <p>
                    {t(
                      locale,
                      "Revisa primero la conexión directa y la asignación de marca. Puedes revocar un candidato existente.",
                      "Review the direct connection and brand assignment first. An existing candidate can still be revoked.",
                    )}
                  </p>
                )}
                <p>
                  {page.current
                    ? statusLabels[page.current.status][locale === "en" ? 1 : 0]
                    : t(
                        locale,
                        "Sin candidato registrado",
                        "No registered candidate",
                      )}
                </p>
                {page.current?.stale && (
                  <p role="status">
                    {t(
                      locale,
                      "El contexto cambió; requiere una nueva revisión.",
                      "The context changed; a new review is required.",
                    )}
                  </p>
                )}
                <p>
                  {t(
                    locale,
                    "La confirmación está bloqueada hasta disponer de evidencia del servidor. Composio no está activo.",
                    "Confirmation is blocked until server evidence is available. Composio is not active.",
                  )}
                </p>
                {page.current &&
                  ["candidate", "blocked"].includes(page.current.status) && (
                    <button
                      type="button"
                      className="button"
                      disabled={locked}
                      onClick={p.onRevoke}
                    >
                      {t(
                        locale,
                        "Revocar candidato en el CRM",
                        "Revoke candidate in CRM",
                      )}
                    </button>
                  )}
              </div>
              <ProtectedForm
                key={p.accountId}
                changesRef={p.formRef}
                busy={p.busy}
                onSubmit={p.onRegister}
              >
                <fieldset
                  disabled={locked || !page.account.ready || p.demo}
                  style={{ border: 0, padding: 0, minWidth: 0 }}
                >
                  <legend>
                    {page.current
                      ? t(
                          locale,
                          "Preparar un nuevo candidato",
                          "Prepare a new candidate",
                        )
                      : t(locale, "Registrar candidato", "Register candidate")}
                  </legend>
                  <p>
                    {t(
                      locale,
                      "Introduce solo identificadores. La API key permanece en el servidor.",
                      "Enter identifiers only. The API key stays on the server.",
                    )}
                  </p>
                  <div className="form-grid">
                    {fields.map(([name, es, en, hintEs, hintEn, max]) => (
                      <label className="field" key={name}>
                        {t(locale, es, en)}
                        <input
                          name={name}
                          required
                          maxLength={max}
                          autoComplete="off"
                          spellCheck={false}
                          aria-describedby={fieldId + "-" + name}
                          style={{
                            minWidth: 0,
                            width: "100%",
                            maxWidth: "100%",
                          }}
                        />
                        <small id={fieldId + "-" + name}>
                          {t(locale, hintEs, hintEn)}
                        </small>
                      </label>
                    ))}
                  </div>
                  <button className="button primary" type="submit">
                    {t(locale, "Revisar candidato", "Review candidate")}
                  </button>
                </fieldset>
              </ProtectedForm>
              <h3>
                {t(locale, "Historial de asociaciones", "Binding history")}
              </h3>
              {!page.history.length && (
                <p>{t(locale, "Aún no hay registros.", "No records yet.")}</p>
              )}
              {page.history.map((row) => (
                <article
                  className="analysis-card"
                  key={row.id}
                  style={{ marginBlock: 8, overflowWrap: "anywhere" }}
                >
                  <strong>
                    {statusLabels[row.status][locale === "en" ? 1 : 0]} ·{" "}
                    {row.revision}
                  </strong>
                  <p>
                    {t(locale, "Conexión", "Connection")}:{" "}
                    {row.external_refs.connection} ·{" "}
                    {t(locale, "Configuración", "Configuration")}:{" "}
                    {row.external_refs.auth_config}
                  </p>
                  <small>
                    {t(
                      locale,
                      "Referencias enmascaradas. Conservamos el registro anterior.",
                      "Masked references. Previous records are preserved.",
                    )}
                  </small>
                </article>
              ))}
              {page.cursor && (
                <button
                  type="button"
                  className="button"
                  disabled={p.loading || p.busy}
                  onClick={p.onMore}
                >
                  {t(locale, "Cargar más registros", "Load more records")}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export function ComposioAccountBindings({
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
  const [account, setAccount] = useState(""),
    [page, setPage] = useState<BindingPage | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [fresh, setFresh] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [intent, setIntent] = useState<Intent | null>(null);
  const generation = useRef(0),
    retry = useRef<{ fingerprint: string; key: string } | null>(null),
    submitting = useRef(false),
    formRef = useRef<HTMLFormElement>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const { requestLeave, confirmation } = useLeaveConfirmation(locale);
  const enabled = allowed && !demo;
  async function read(id: string, cursor: string | null, signal?: AbortSignal) {
    const query = new URLSearchParams({ limit: "25" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(
      `/api/mail/accounts/${encodeURIComponent(id)}/composio?${query}`,
      { cache: "no-store", signal },
    );
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        typeof body.code === "string" ? body.code : "C_BINDING_UNAVAILABLE",
      );
    const parsed = bindingPageSchema.safeParse(body);
    if (
      !parsed.success ||
      parsed.data.account.id !== id ||
      (cursor !== null && parsed.data.cursor === cursor)
    )
      throw new Error("C_BINDING_UNAVAILABLE");
    return parsed.data;
  }
  async function refresh(id = account, signal?: AbortSignal) {
    if (!enabled || !id) return;
    const g = ++generation.current;
    setLoading(true);
    setFresh(false);
    setError("");
    try {
      const next = await read(id, null, signal);
      if (g === generation.current) {
        setPage(next);
        setFresh(true);
      }
    } catch (e) {
      if (!signal?.aborted && g === generation.current)
        setError((e as Error).message);
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (!enabled || !account) return;
    const controller = new AbortController();
    void refresh(account, controller.signal);
    return () => {
      controller.abort();
      generation.current++;
    };
    // One account owns this request; responses from a previous account are discarded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, enabled]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function more() {
    if (!page?.cursor || loading || busy) return;
    const g = generation.current;
    setLoading(true);
    setError("");
    try {
      const next = await read(account, page.cursor);
      if (g !== generation.current) return;
      if (
        next.head_revision !== page.head_revision ||
        next.account.context_hash !== page.account.context_hash
      )
        throw new Error("C_BINDING_STALE");
      setPage({
        ...next,
        history: [
          ...page.history,
          ...next.history.filter(
            (r) => !page.history.some((old) => old.id === r.id),
          ),
        ],
      });
    } catch (e) {
      if (g === generation.current) {
        setError((e as Error).message);
        setFresh(false);
      }
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }
  function prepare(kind: BindingKind, extra: Record<string, unknown>) {
    if (
      !page ||
      page.account.id !== account ||
      !fresh ||
      loading ||
      busy ||
      !enabled
    )
      return;
    const parsed = parseBindingCommand({
      kind,
      payload: { ...bindingExpected(page), ...extra },
      idempotency_key: "00000000-0000-4000-8000-000000000000",
    });
    if (!parsed) {
      setError("C_BINDING_INVALID_INPUT");
      return;
    }
    retry.current = bindingRequest(
      retry.current,
      account,
      kind,
      parsed.payload,
      () => crypto.randomUUID(),
    );
    setIntent({
      account,
      kind,
      payload: parsed.payload,
      key: retry.current.key,
      email: page.account.email,
      brand: page.account.brand_name,
    });
    setError("");
    setNotice("");
  }
  async function save() {
    if (!intent || submitting.current || !enabled) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/mail/accounts/${encodeURIComponent(intent.account)}/composio`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: intent.kind,
            payload: intent.payload,
            idempotency_key: intent.key,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          typeof body.code === "string" ? body.code : "C_BINDING_UNAVAILABLE",
        );
      if (!bindingResultSchema.safeParse(body).success)
        throw new Error("C_BINDING_UNAVAILABLE");
      retry.current = null;
      setIntent(null);
      formRef.current?.reset();
      if (formRef.current) markFormSaved(formRef.current);
      setNotice(
        t(
          locale,
          "Guardado en el CRM. Gmail directo continúa activo.",
          "Saved in CRM. Direct Gmail remains active.",
        ),
      );
      await refresh(intent.account);
    } catch (e) {
      const code = (e as Error).message;
      setError(code);
      setIntent(null);
      if (responseNeedsRefresh(code)) setFresh(false);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <ComposioAccountBindingsView
        locale={locale}
        allowed={allowed}
        demo={demo}
        accounts={accounts}
        accountId={account}
        page={page}
        loading={loading}
        busy={busy || !!intent}
        fresh={fresh}
        error={error}
        notice={notice}
        formRef={formRef}
        errorRef={errorRef}
        onAccount={(id) =>
          requestLeave(() => {
            generation.current++;
            setAccount(id);
            setPage(null);
            setLoading(false);
            setFresh(false);
            setError("");
            setNotice("");
            retry.current = null;
          }, formRef.current)
        }
        onRefresh={() => void refresh()}
        onMore={() => void more()}
        onRegister={(event) => {
          event.preventDefault();
          prepare(
            "register_candidate",
            Object.fromEntries(new FormData(event.currentTarget)),
          );
        }}
        onRevoke={() => {
          if (page?.current)
            prepare("revoke_binding", {
              binding_id: page.current.id,
              reason: "operator_revoked",
            });
        }}
      />
      {confirmation}
      {intent && (
        <Modal
          locale={locale}
          title={
            intent.kind === "revoke_binding"
              ? t(locale, "Revisar revocación local", "Review local revocation")
              : t(locale, "Revisar candidato", "Review candidate")
          }
          close={() => {
            if (!busy) setIntent(null);
          }}
        >
          <p style={{ overflowWrap: "anywhere" }}>
            {intent.email} ·{" "}
            {intent.brand || t(locale, "Marca pendiente", "Pending brand")}
          </p>
          <p>
            {intent.kind === "revoke_binding"
              ? t(
                  locale,
                  "Revoca únicamente esta asociación en el CRM. No revoca Google ni cambia Gmail directo.",
                  "Revokes only this CRM binding. Google authorization and direct Gmail stay unchanged.",
                )
              : t(
                  locale,
                  "Guardaremos un candidato pendiente. Si ya había uno, conservaremos su registro anterior. No activa Composio.",
                  "We will save a pending candidate and preserve any previous record. Composio will stay inactive.",
                )}
          </p>
          <div className="modal-footer">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setIntent(null)}
            >
              {t(locale, "Continuar editando", "Continue editing")}
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {t(locale, "Confirmar cambio local", "Confirm local change")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function responseNeedsRefresh(code: string) {
  return [
    "C_BINDING_STALE",
    "C_BINDING_ACCOUNT_NOT_READY",
    "C_BINDING_UNAVAILABLE",
  ].includes(code);
}
