"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Mail, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import {
  mailConnectionsOptions,
  mailConnectionView,
  mailConnectionLabels,
  matchingAdvisor,
  type MailConnection,
} from "@/lib/mail-connections";
import type { ConnectionAccount } from "@/lib/connections";
import { ProtectedForm } from "./unsaved-changes";
import "./mail-connection-panel.css";

type Options = ReturnType<typeof mailConnectionsOptions.parse>;
type RetryAction =
  { kind: "connect" } | { kind: "continue"; id: string } | { kind: "refresh" };
export function MailConnectionPanel({
  provider,
  accounts,
  onAvailable,
  onChanged,
  hideUnavailable = false,
  demo = false,
}: {
  provider: "gmail_oauth" | "composio";
  accounts: ConnectionAccount[];
  onAvailable?: (available: boolean) => void;
  onChanged?: () => void;
  hideUnavailable?: boolean;
  demo?: boolean;
}) {
  const heading = useId(),
    [options, setOptions] = useState<Options | null>(null),
    [email, setEmail] = useState(""),
    [advisor, setAdvisor] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [retry, setRetry] = useState<RetryAction | null>(null);
  const intent = useRef<{ fingerprint: string; key: string } | null>(null),
    continued = useRef(new Set<string>()),
    mounted = useRef(true);
  const name = provider === "gmail_oauth" ? "Gmail" : "Composio";
  async function response<T>(
    r: Response,
    schema: { parse(v: unknown): T },
  ): Promise<T> {
    const value = await r.json();
    if (!r.ok)
      throw Error(
        typeof value.error === "string"
          ? value.error
          : "No se pudo completar la conexión.",
      );
    return schema.parse(value);
  }
  async function load() {
    if (demo) {
      setOptions({
        enabled: true,
        included_available: false,
        composio_enabled: false,
        direct_account_ids: [],
        advisors: [],
        connections: [],
      });
      setLoading(false);
      onAvailable?.(true);
      return;
    }
    setLoading(true);
    try {
      const value = await response(
        await fetch("/api/mail/connections", { cache: "no-store" }),
        mailConnectionsOptions,
      );
      if (mounted.current) {
        setOptions(value);
        onAvailable?.(value.enabled);
        setError("");
        setRetry(null);
      }
    } catch (e) {
      if (mounted.current) {
        if (!options?.enabled) onAvailable?.(false);
        setError(
          e instanceof Error
            ? e.message
            : "Actualiza el estado para continuar.",
        );
        setRetry({ kind: "refresh" });
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [demo]);
  useEffect(() => {
    if (!options || demo) return;
    const id = new URLSearchParams(window.location.search).get(
      "mail_connection",
    );
    const row = options.connections.find(
      (r) => r.id === id && r.provider === provider,
    );
    if (
      !row ||
      row.state === "ready" ||
      row.state === "disconnected" ||
      continued.current.has(row.id)
    )
      return;
    continued.current.add(row.id);
    void continueConnection(row.id, false);
  }, [options, provider, demo]);
  async function continueConnection(id: string, navigate = true) {
    setBusy(true);
    setError("");
    setRetry(null);
    try {
      const row = await response(
        await fetch(
          `/api/mail/connections/${encodeURIComponent(id)}/continue`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
        ),
        mailConnectionView,
      );
      if (navigate && row.authorization_url) {
        window.location.assign(row.authorization_url);
        return;
      }
      setOptions((old) =>
        old
          ? {
              ...old,
              connections: [row, ...old.connections.filter((r) => r.id !== id)],
            }
          : old,
      );
      setNotice(
        row.state === "ready"
          ? "Cuenta lista. Puedes seleccionarla en campañas y conversaciones."
          : row.authorization_url
            ? "Pulsa Retomar preparación para completar la autorización pendiente."
            : "La preparación se retomará desde el último paso guardado.",
      );
      if (row.state === "ready") onChanged?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo retomar la preparación.",
      );
      setRetry({ kind: "continue", id });
    } finally {
      setBusy(false);
    }
  }
  async function connect(e?: { preventDefault(): void }) {
    e?.preventDefault();
    if (demo) {
      setNotice(
        "Demostración: no se abrirá Google ni se conectarán cuentas reales.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setRetry(null);
    const normalized = email.trim().toLowerCase(),
      matched = matchingAdvisor(normalized, options?.advisors ?? []);
    const body = {
        email: normalized,
        provider,
        ...(!matched && advisor ? { advisor_id: advisor } : {}),
      },
      fingerprint = JSON.stringify(body);
    if (intent.current?.fingerprint !== fingerprint)
      intent.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const row = await response(
        await fetch("/api/mail/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...body,
            idempotency_key: intent.current.key,
          }),
        }),
        mailConnectionView,
      );
      const url = new URL(window.location.href);
      url.searchParams.set("module", "connections");
      url.searchParams.set("mail_connection", row.id);
      url.searchParams.set("mail_provider", provider);
      window.history.replaceState(null, "", url);
      if (row.authorization_url) {
        window.location.assign(row.authorization_url);
        return;
      }
      continued.current.add(row.id);
      await load();
      if (row.state !== "ready") await continueConnection(row.id);
      else {
        setNotice("Esta cuenta ya está lista.");
        onChanged?.();
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo conectar la cuenta.",
      );
      setRetry({ kind: "connect" });
    } finally {
      setBusy(false);
    }
  }
  async function disconnect(row: MailConnection) {
    setBusy(true);
    setError("");
    try {
      await response(
        await fetch(`/api/mail/connections/${row.id}/disconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
        mailConnectionView,
      );
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo desconectar.");
      setRetry({ kind: "refresh" });
    } finally {
      setBusy(false);
    }
  }
  if (hideUnavailable && !options?.enabled) return null;
  const match = matchingAdvisor(email, options?.advisors ?? []),
    latest = new Map<string, MailConnection>();
  for (const row of options?.connections ?? [])
    if (row.provider === provider && !latest.has(row.email))
      latest.set(row.email, row);
  const rows = new Map(
    accounts
      .filter((a) =>
        provider === "gmail_oauth"
          ? options?.direct_account_ids.includes(a.id) || latest.has(a.email)
          : !["none", "unavailable"].includes(a.association) ||
            latest.has(a.email),
      )
      .map((a) => [a.email, a]),
  );
  for (const row of latest.values())
    if (!rows.has(row.email))
      rows.set(row.email, null as unknown as ConnectionAccount);
  return (
    <section
      className="simple-mail panel"
      aria-labelledby={heading}
      aria-busy={busy || loading}
    >
      <header className="cx-heading">
        <div>
          <h2 id={heading}>
            <Mail size={20} />
            {name}
          </h2>
          <p>
            {provider === "gmail_oauth"
              ? "Conecta tu correo de trabajo directamente con Google."
              : "Conecta mediante Composio. Puede respaldar tus envíos cuando esté disponible."}
          </p>
        </div>
        <button
          className="button"
          type="button"
          onClick={() => void load()}
          disabled={busy || loading}
        >
          <RefreshCw size={15} /> Actualizar estado
        </button>
      </header>
      <p className="muted">
        Lee y responde conversaciones, envía correos y usa esta cuenta en
        campañas desde el CRM.
      </p>
      {loading && <p role="status">Consultando conexiones…</p>}
      {error && (
        <div className="simple-mail-alert" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
          {retry && (
            <button
              type="button"
              className="button"
              disabled={busy || loading}
              onClick={() => {
                if (retry.kind === "connect") void connect();
                else if (retry.kind === "continue")
                  void continueConnection(retry.id);
                else void load();
              }}
            >
              {retry.kind === "connect"
                ? "Reintentar conexión"
                : retry.kind === "continue"
                  ? "Retomar conexión"
                  : "Actualizar estado"}
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className="simple-mail-notice" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </p>
      )}
      {provider === "composio" &&
        options?.enabled &&
        !options.composio_enabled && (
          <p className="simple-mail-notice" role="status">
            Composio permanece deshabilitado mientras confirmamos el cupo
            gratuito. Puedes conectar tu cuenta con Gmail directo.
          </p>
        )}
      {options?.enabled &&
        (provider === "gmail_oauth" || options.composio_enabled) && (
          <ProtectedForm onSubmit={connect} busy={busy}>
            <div className="simple-mail-form">
              <label className="field">
                Correo de trabajo
                <input
                  required
                  type="email"
                  autoComplete="email"
                  placeholder="asesor@tuempresa.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setAdvisor("");
                    setRetry(null);
                    setError("");
                    setNotice("");
                  }}
                  disabled={busy}
                />
              </label>
              {email.includes("@") && !match && (
                <label className="field">
                  Asesor responsable
                  <select
                    required
                    value={advisor}
                    onChange={(e) => {
                      setAdvisor(e.target.value);
                      setRetry(null);
                      setError("");
                      setNotice("");
                    }}
                    disabled={busy}
                  >
                    <option value="">Selecciona un asesor</option>
                    {options.advisors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                className="button primary"
                disabled={busy || loading}
                type="submit"
              >
                {busy
                  ? "Preparando…"
                  : provider === "gmail_oauth"
                    ? "Conectar con Google"
                    : "Conectar con Composio"}
              </button>
            </div>
            <p className="muted">
              Autoriza una vez. Prepararemos los permisos y la sincronización de
              los últimos 30 días automáticamente.
            </p>
            {match && (
              <p className="muted">
                Responsable:{" "}
                {options.advisors.find((a) => a.id === match)?.name}
              </p>
            )}
          </ProtectedForm>
        )}
      {rows.size > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Estado</th>
                <th>Última sincronización</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([address, account]) => {
                  const row = latest.get(address);
                  const synced = row?.last_synced_at ?? account?.synced_at;
                  return (
                    <tr key={address}>
                      <td>{address}</td>
                      <td>
                        <span
                          className={`badge ${row?.state === "ready" ? "good" : "warn"}`}
                        >
                          {row
                            ? mailConnectionLabels[row.state]
                            : provider === "gmail_oauth"
                              ? "Conectada"
                              : "Preparando"}
                        </span>
                      </td>
                      <td>
                        {synced
                          ? new Intl.DateTimeFormat("es-CO", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(synced))
                          : "Aún sin sincronización"}
                        {row?.sync_status && (
                          <p className="muted">
                            {
                              {
                                pending: "Sincronización pendiente",
                                syncing: "Sincronizando…",
                                current: "Actualizada",
                                attention:
                                  "Revisa la sincronización; actualiza el estado para comprobarla.",
                              }[row.sync_status]
                            }
                          </p>
                        )}
                      </td>
                      <td>
                        <div className="button-row">
                          {row &&
                          ["preparing", "authorizing", "prepared"].includes(
                            row.state,
                          ) ? (
                            <button
                              className="button"
                              type="button"
                              disabled={
                                busy ||
                                (provider === "composio" &&
                                  !options?.composio_enabled)
                              }
                              onClick={() => void continueConnection(row.id)}
                            >
                              Retomar preparación
                            </button>
                          ) : (
                            <button
                              className="button"
                              type="button"
                              disabled={
                                busy ||
                                (provider === "composio" &&
                                  !options?.composio_enabled)
                              }
                              onClick={() => {
                                setEmail(address);
                                setAdvisor("");
                                intent.current = null;
                              }}
                            >
                              Reconectar
                            </button>
                          )}
                          {row?.state === "ready" && (
                            <button
                              className="button"
                              type="button"
                              disabled={busy}
                              onClick={() => void disconnect(row)}
                            >
                              Desconectar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : (
        !loading && (
          <p className="muted">Las cuentas que conectes aparecerán aquí.</p>
        )
      )}
      {provider === "composio" && (
        <p className="muted">
          {options?.included_available
            ? "Cupo incluido disponible para comprobar conexiones y respaldar envíos."
            : "Respaldo sin cupo gratuito confirmado: no se harán llamadas de pago."}{" "}
          Gmail directo es la vía principal cuando está disponible. Nunca se
          repite un envío de resultado incierto.
        </p>
      )}
    </section>
  );
}
