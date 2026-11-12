"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/domain";
import { bindingExpected, bindingErrorText } from "@/lib/composio-bindings";
import {
  bindingCommandV2Schema,
  bindingPageV2Schema,
  checkCommandV2Schema,
  checkResultV2Schema,
  bindingResultV2Schema,
  type BindingPageV2,
} from "@/lib/composio-bindings-v2";
import {
  ProtectedForm,
  markFormSaved,
  useLeaveConfirmation,
} from "./unsaved-changes";
import { Modal, t } from "./ui";
import { ComposioVerificationSetup } from "./composio-verification-setup";

type Props = {
  locale: Locale;
  allowed: boolean;
  demo?: boolean;
  accounts: { id: string; email: string }[];
};
type Intent = {
  account: string;
  kind: "register_candidate" | "confirm_binding" | "revoke_binding" | "check";
  body: unknown;
  key: string;
};
export function ComposioAccountBindingsV2({
  locale,
  allowed,
  demo,
  accounts,
}: Props) {
  const [account, setAccount] = useState(accounts[0]?.id ?? ""),
    [page, setPage] = useState<BindingPageV2 | null>(null),
    [operationBusy, setBusy] = useState(false),
    [setupBusy, setSetupBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [intent, setIntent] = useState<Intent | null>(null);
  const busy = operationBusy || setupBusy;
  const generation = useRef(0),
    submitting = useRef(false),
    errorRef = useRef<HTMLParagraphElement>(null),
    retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null),
    { requestLeave, confirmation } = useLeaveConfirmation(locale);
  const tr = (es: string, en: string) => t(locale, es, en);
  const titleId = useId();
  const statusText = (status: string) =>
    locale === "en"
      ? status
      : ({
          candidate: "Candidata",
          verified: "Verificada",
          blocked: "Bloqueada",
          revoked: "Revocada",
          superseded: "Reemplazada",
          prepared: "Preparada",
          completed: "Completada",
          failed: "Fallida",
          expired: "Caducada",
        }[status] ?? status);
  const errorText = (e: unknown) =>
    bindingErrorText(
      e && typeof e === "object" && "code" in e && typeof e.code === "string"
        ? e.code
        : "C_BINDING_UNAVAILABLE",
      locale,
    );
  const base = (id: string) =>
    `/api/mail/accounts/${encodeURIComponent(id)}/composio`;
  async function load(id: string, cursor?: string) {
    const g = ++generation.current;
    setLoading(true);
    setError("");
    setPage(null);
    try {
      const r = await fetch(
        base(id) +
          "?contract_version=2&limit=25" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        {
          cache: "no-store",
        },
      );
      const data = await r.json();
      if (!r.ok) throw data;
      const p = bindingPageV2Schema.parse(data);
      if (p.account.id !== id) throw new Error();
      if (g === generation.current) setPage(p);
    } catch (e) {
      if (g === generation.current) setError(errorText(e));
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (allowed && !demo && account) void load(account);
    return () => {
      generation.current++;
    };
  }, [account, allowed, demo]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!page?.can_confirm || !page.latest_check?.valid_until) return;
    const timeout = setTimeout(
      () => setPage((p) => (p ? { ...p, can_confirm: false } : p)),
      Math.max(0, Date.parse(page.latest_check.valid_until) - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [page?.latest_check?.valid_until, page?.can_confirm]);
  function prepare(kind: Intent["kind"], payload: Record<string, unknown>) {
    if (!page || busy || loading) return;
    const body =
      kind === "check"
        ? {
            contract_version: 2,
            binding_id: page.current?.id,
            expected: bindingExpected(page),
          }
        : {
            contract_version: 2,
            kind,
            payload: { ...bindingExpected(page), ...payload },
          };
    const fingerprint = JSON.stringify({ account, body });
    const key =
      retry.current?.fingerprint === fingerprint
        ? retry.current.key
        : crypto.randomUUID();
    retry.current = { fingerprint, key };
    const input = { ...body, idempotency_key: key };
    const parsed =
      kind === "check"
        ? checkCommandV2Schema.safeParse(input)
        : bindingCommandV2Schema.safeParse(input);
    if (!parsed.success) {
      setError(
        tr(
          "Revisa los identificadores de la conexión.",
          "Review the connection identifiers.",
        ),
      );
      return;
    }
    setError("");
    setIntent({ account, kind, body: parsed.data, key });
  }
  function register(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    prepare(
      "register_candidate",
      Object.fromEntries(new FormData(e.currentTarget)),
    );
  }
  async function execute() {
    if (!intent || submitting.current || intent.account !== account) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        base(account) + (intent.kind === "check" ? "/check" : ""),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(intent.body),
        },
      );
      const data = await r.json();
      if (!r.ok) throw data;
      if (intent.kind === "check") checkResultV2Schema.parse(data);
      else bindingResultV2Schema.parse(data);
      if (intent.kind === "register_candidate" && formRef.current)
        markFormSaved(formRef.current);
      retry.current = null;
      setIntent(null);
      setNotice(
        tr(
          "Resultado guardado. La asociación no activa el proveedor.",
          "Result saved. Binding does not activate the provider.",
        ),
      );
      await load(account);
    } catch (e) {
      setError(errorText(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (!allowed || demo) return null;
  return (
    <section
      className="panel settings-panel"
      aria-labelledby={titleId}
      aria-busy={busy || loading}
      style={{ minWidth: 0 }}
    >
      <h2 id={titleId}>
        {tr("Asociación de Gmail con Composio", "Gmail binding with Composio")}
      </h2>
      <p>
        {tr(
          "Registra una conexión existente, comprueba sus permisos y confirma la asociación. Gmail directo se conserva.",
          "Register an existing connection, check its permissions, and confirm the binding. Direct Gmail is preserved.",
        )}
      </p>
      <label className="field">
        {tr("Buzón", "Mailbox")}
        <select
          value={account}
          disabled={busy || !!intent}
          onChange={(e) => {
            const id = e.target.value;
            requestLeave(() => {
              setAccount(id);
              setNotice("");
              retry.current = null;
            }, formRef.current);
          }}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="button"
        disabled={!account || busy || loading || !!intent}
        onClick={() => requestLeave(() => void load(account), formRef.current)}
      >
        {tr("Actualizar revisión", "Refresh review")}
      </button>
      {error && (
        <p role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && (
        <p role="status">{tr("Cargando revisión…", "Loading review…")}</p>
      )}
      <ComposioVerificationSetup
        account={account}
        locale={locale}
        allowed={allowed}
        demo={demo}
        disabled={operationBusy || loading || !!intent}
        onLockChange={setSetupBusy}
        reviewAction={(action) => requestLeave(action, formRef.current)}
        onChanged={() => void load(account)}
      />
      {page && (
        <>
          <p>
            {tr("Marca", "Brand")}:{" "}
            {page.account.brand_name ?? tr("Sin asignar", "Unassigned")}
          </p>
          <p>
            {tr("Estado de asociación", "Binding status")}:{" "}
            {page.current
              ? statusText(page.current.status)
              : tr("Sin asociación", "No binding")}
            {page.current?.stale
              ? tr(" · revisión desactualizada", " · stale review")
              : ""}
          </p>
          <p>
            {tr("Comprobación", "Verification")}:{" "}
            {page.latest_check
              ? statusText(page.latest_check.status)
              : tr("Sin comprobación", "Not checked")}
          </p>
          {page.latest_check?.valid_until && (
            <p>
              {tr("Confirmar antes de", "Confirm before")}:{" "}
              <time dateTime={page.latest_check.valid_until}>
                {new Date(page.latest_check.valid_until).toLocaleTimeString(
                  locale,
                )}
              </time>
            </p>
          )}
          {!page.verification_available && (
            <p>
              {tr(
                "La comprobación requiere cupo incluido confirmado, presupuesto vigente y controles del servidor habilitados.",
                "Checking requires confirmed included quota, a current budget, and enabled server controls.",
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
                busy ||
                !!intent ||
                !page.verification_available ||
                !page.current
              }
              onClick={() => prepare("check", {})}
            >
              {tr("Comprobar permisos", "Check permissions")}
            </button>
            <button
              type="button"
              className="button"
              disabled={
                busy ||
                !!intent ||
                !page.can_confirm ||
                !page.current ||
                !page.latest_check
              }
              onClick={() =>
                prepare("confirm_binding", {
                  binding_id: page.current!.id,
                  check_id: page.latest_check!.id,
                })
              }
            >
              {tr("Confirmar asociación", "Confirm binding")}
            </button>
            <button
              type="button"
              className="button"
              disabled={
                busy ||
                !!intent ||
                !page.current ||
                !["candidate", "verified", "blocked"].includes(
                  page.current.status,
                )
              }
              onClick={() =>
                prepare("revoke_binding", {
                  binding_id: page.current!.id,
                  reason: "operator_revoked",
                })
              }
            >
              {tr("Revocar asociación local", "Revoke local binding")}
            </button>
          </div>
          <ProtectedForm
            changesRef={formRef}
            onSubmit={register}
            busy={busy || !!intent}
          >
            <fieldset
              disabled={busy || !!intent || !page.account.ready}
              style={{ border: 0, padding: 0, minWidth: 0 }}
            >
              <legend>
                {tr(
                  "Registrar conexión existente",
                  "Register existing connection",
                )}
              </legend>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit,minmax(min(100%,240px),1fr))",
                  gap: 12,
                }}
              >
                {[
                  [
                    "composio_project_id",
                    "Proyecto Composio",
                    "Composio project",
                  ],
                  ["auth_config_id", "Auth Config", "Auth Config"],
                  ["connected_account_id", "Conexión", "Connection"],
                  ["composio_user_id", "Usuario Composio", "Composio user"],
                ].map(([name, es, en]) => (
                  <label className="field" key={name}>
                    {tr(es, en)}
                    <input
                      name={name}
                      required
                      maxLength={name === "composio_user_id" ? 1024 : 131}
                      autoComplete="off"
                      style={{ width: "100%", minWidth: 0 }}
                    />
                  </label>
                ))}
              </div>
              <button type="submit" className="button">
                {tr("Revisar registro", "Review registration")}
              </button>
            </fieldset>
          </ProtectedForm>
          <details>
            <summary>
              {tr("Historial de asociaciones", "Binding history")}
            </summary>
            <ul>
              {page.history.map((row) => (
                <li key={row.id} style={{ overflowWrap: "anywhere" }}>
                  {statusText(row.status)} · {row.external_refs.connection} ·{" "}
                  {row.reason ?? "—"}
                </li>
              ))}
            </ul>
            {page.cursor && (
              <button
                type="button"
                className="button"
                disabled={busy || loading || !!intent}
                onClick={() =>
                  requestLeave(
                    () => void load(account, page.cursor!),
                    formRef.current,
                  )
                }
              >
                {tr("Siguiente página", "Next page")}
              </button>
            )}
          </details>
        </>
      )}
      {intent && (
        <Modal
          locale={locale}
          title={tr("Revisar acción", "Review action")}
          close={() => {
            if (!busy) setIntent(null);
          }}
          busy={busy}
        >
          <p style={{ overflowWrap: "anywhere" }}>
            {page?.account.email} · {page?.account.brand_name}
          </p>
          <p>
            {intent.kind === "check"
              ? tr(
                  "Autorizar esta comprobación utiliza hasta 4 peticiones de Composio del presupuesto vigente. No envía mensajes.",
                  "This check uses up to 4 Composio requests from the current budget. It sends no messages.",
                )
              : intent.kind === "confirm_binding"
                ? tr(
                    "Confirma la identidad y permisos comprobados. No cambia el proveedor ni activa Composio.",
                    "Confirm the checked identity and permissions. This does not change the provider or activate Composio.",
                  )
                : intent.kind === "register_candidate"
                  ? tr(
                      "Registra una asociación candidata. Aún no estará verificada.",
                      "Register a candidate binding. It will not yet be verified.",
                    )
                  : tr(
                      "Revoca solo la asociación local. No desconecta Google.",
                      "Revoke only the local binding. This does not disconnect Google.",
                    )}
          </p>
          {error && (
            <p role="alert" tabIndex={-1} ref={errorRef}>
              {error}
            </p>
          )}
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => void execute()}
          >
            {busy
              ? tr("Procesando…", "Working…")
              : tr("Confirmar esta acción", "Confirm this action")}
          </button>
        </Modal>
      )}
      {confirmation}
    </section>
  );
}
