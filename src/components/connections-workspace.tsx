"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUpRight,
  Cable,
  CheckCircle2,
  Clock3,
  Mail,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import type { Locale, Workspace } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import {
  connectionsAllowed,
  connectionsSchema,
  connectionTotals,
  demoConnections,
  type ConnectionsSnapshot,
  type ConnectionTab,
} from "@/lib/connections";
import type { Action } from "./crm";
import { t } from "./ui";
import { ComposioConnect } from "./composio-connect";
import { ComposioAccountBindings } from "./composio-account-bindings";
import { ComposioAccountBindingsV2 } from "./composio-account-bindings-v2";
import { MailTransportSettings } from "./mail-transport-settings";
import { GmailHistory } from "./gmail-history";
import { InstantlyTrialControl } from "./instantly-trial-control";
import { Integrations } from "./integrations";
import "./connections-workspace.css";
import { MailConnectionPanel } from "./mail-connection-panel";

export function ConnectionsWorkspace({
  data,
  locale,
  act,
  busy,
  openCase,
  connectLegacy,
  onAccountsChanged,
  initialSnapshot,
  initialTab = "gmail",
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  busy: boolean;
  openCase?: (id: string) => void;
  connectLegacy?: () => void;
  onAccountsChanged?: () => void;
  initialSnapshot?: ConnectionsSnapshot;
  initialTab?: ConnectionTab;
}) {
  const allowed = connectionsAllowed(data.profile, data.demo);
  const [tab, setTab] = useState<ConnectionTab>(initialTab),
    [query, setQuery] = useState("");
  const [simpleUi, setSimpleUi] = useState(false);
  useEffect(() => {
    const provider = new URLSearchParams(window.location.search).get(
      "mail_provider",
    );
    if (provider) setTab(provider === "composio" ? "composio" : "gmail");
  }, []);
  const [snapshot, setSnapshot] = useState<ConnectionsSnapshot | null>(
    () =>
      initialSnapshot ?? (data.demo ? demoConnections(data.accounts) : null),
  );
  const [loading, setLoading] = useState(!data.demo && !initialSnapshot),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const mailChanged = () => {
    setRevision((v) => v + 1);
    onAccountsChanged?.();
  };
  const id = useId(),
    tabs = useRef<HTMLDivElement>(null),
    connect = useRef<HTMLDivElement>(null);
  const l = (es: string, en: string) => t(locale, es, en);
  const manage: Action = async (kind, payload) => {
    const result = await act(kind, payload);
    setRevision((value) => value + 1);
    return result;
  };
  useEffect(() => {
    if (!allowed || data.demo || initialSnapshot) return;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/connections", { cache: "no-store", signal: abort.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return connectionsSchema.parse(await r.json());
      })
      .then((value) => {
        if (!abort.signal.aborted) setSnapshot(value);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setSnapshot(null);
          setError(
            l(
              "No se pudo consultar el resumen. Puedes volver a intentarlo.",
              "The summary could not be loaded. You can try again.",
            ),
          );
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [allowed, data.demo, initialSnapshot, revision, locale]);
  if (!allowed)
    return (
      <section className="panel" role="status">
        <ShieldCheck size={24} />
        <h2>{l("Acceso administrativo", "Administrative access")}</h2>
        <p>
          {l(
            "Las conexiones se administran con una cuenta superadmin activa y segundo factor.",
            "Connections require an active superadmin account and two-factor authentication.",
          )}
        </p>
      </section>
    );
  const Bindings =
    data.mail_binding_contract_version === 2
      ? ComposioAccountBindingsV2
      : ComposioAccountBindings;
  const accounts = snapshot?.accounts ?? [],
    total = snapshot ? connectionTotals(accounts) : null;
  const filtered = accounts
    .filter((a) =>
      [a.email, a.organization, a.brand]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
    )
    .sort((a, b) => a.email.localeCompare(b.email));
  const number = (n: number | null | undefined) =>
    n == null
      ? "—"
      : new Intl.NumberFormat(locale === "es" ? "es-CO" : "en-US").format(n);
  const date = (value: string | null) =>
    value ? dateLabel(value, locale, true) : l("No disponible", "Unavailable");
  const association = (status: string, stale: boolean | null) =>
    stale
      ? l("Revisar de nuevo", "Review again")
      : (
          {
            none: l("Sin asociación", "Not linked"),
            candidate: l("Pendiente de revisión", "Review pending"),
            verified: l("Confirmada en CRM", "Confirmed in CRM"),
            blocked: l("Bloqueada", "Blocked"),
            revoked: l("Revocada", "Revoked"),
            superseded: l("Sustituida", "Replaced"),
            unavailable: l("No disponible", "Unavailable"),
          } as Record<string, string>
        )[status] || status;
  function key(e: KeyboardEvent<HTMLButtonElement>, selected: ConnectionTab) {
    const names: ConnectionTab[] = [
        "gmail",
        "composio",
        "instantly",
        "texttorrent",
      ],
      index = names.indexOf(selected);
    const next =
      e.key === "ArrowRight"
        ? (index + 1) % names.length
        : e.key === "ArrowLeft"
          ? (index + names.length - 1) % names.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? names.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(names[next]);
    tabs.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }
  return (
    <div className="connections-workspace">
      <div className="cx-intro">
        <div>
          <span className="cx-eyebrow">
            <Cable size={15} />
            {l(
              "TUS PROVEEDORES, EN UN SOLO LUGAR",
              "YOUR PROVIDERS, IN ONE PLACE",
            )}
          </span>
          <p>
            {l(
              "Consulta tus cuentas y administra cómo se conectan al CRM.",
              "See your accounts and manage how they connect to the CRM.",
            )}
          </p>
        </div>
        <span className="cx-admin">
          <ShieldCheck size={15} />
          {l("Acceso administrativo", "Administrative access")}
        </span>
      </div>
      {data.demo && (
        <p className="cx-notice">
          {l(
            "Vista de demostración · cuentas y métricas ficticias",
            "Demo view · fictional accounts and metrics",
          )}
        </p>
      )}
      <div
        className="cx-tabs"
        role="tablist"
        aria-label={l("Proveedores de conexión", "Connection providers")}
        ref={tabs}
      >
        {(
          [
            [
              "gmail",
              "Gmail",
              Mail,
              l("Conexión directa con Google", "Direct Google connection"),
            ],
            [
              "composio",
              "Composio",
              Mail,
              l("Correo del equipo", "Team email"),
            ],
            [
              "instantly",
              "Instantly",
              Zap,
              l("Prospección por correo", "Email outreach"),
            ],
            [
              "texttorrent",
              "TextTorrent",
              MessageSquare,
              l("Mensajería SMS", "SMS messaging"),
            ],
          ] as const
        ).map(([name, label, Icon, detail]) => (
          <button
            key={name}
            id={`${id}-${name}`}
            type="button"
            role="tab"
            aria-selected={tab === name}
            aria-controls={`${id}-${name}-panel`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={(e) => key(e, name)}
          >
            <span className={`cx-provider-icon cx-${name}`}>
              <Icon size={21} />
            </span>
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
            {name === "texttorrent" && (
              <span className="cx-mini">{l("Pendiente", "Pending")}</span>
            )}
          </button>
        ))}
      </div>
      <section
        className="cx-panel"
        role="tabpanel"
        aria-labelledby={`${id}-gmail`}
        id={`${id}-gmail-panel`}
        hidden={tab !== "gmail"}
        inert={tab !== "gmail"}
      >
        <MailConnectionPanel
          provider="gmail_oauth"
          accounts={accounts}
          demo={data.demo}
          onChanged={mailChanged}
        />
      </section>
      <section
        className="cx-panel"
        role="tabpanel"
        aria-labelledby={`${id}-composio`}
        id={`${id}-composio-panel`}
        hidden={tab !== "composio"}
        inert={tab !== "composio"}
      >
        <MailConnectionPanel
          provider="composio"
          accounts={accounts}
          demo={data.demo}
          hideUnavailable
          onAvailable={setSimpleUi}
          onChanged={mailChanged}
        />
        {!simpleUi && (
          <div>
            <div className="cx-heading">
              <div>
                <h2>
                  Composio <span className="cx-mini">Gmail</span>
                </h2>
                <p>
                  {l(
                    "Cada buzón mantiene su identidad, marca y permisos.",
                    "Each mailbox keeps its identity, brand and permissions.",
                  )}
                </p>
              </div>
              <button
                type="button"
                className="button primary"
                disabled={data.demo}
                onClick={() => {
                  connect.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                  connect.current
                    ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
                    ?.focus({ preventScroll: true });
                }}
              >
                <Mail size={16} />
                {l("Conectar correo", "Connect email")}
                <ArrowUpRight size={15} />
              </button>
            </div>
            <div className="cx-stats" aria-busy={loading}>
              {[
                [
                  l("Buzones registrados", "Registered mailboxes"),
                  total?.accounts,
                  l("Cuentas visibles en el CRM", "Accounts visible in CRM"),
                ],
                [
                  l("Gmail conectados", "Connected Gmail accounts"),
                  total?.gmailConnected,
                  l("Estado registrado de Gmail", "Recorded Gmail status"),
                ],
                [
                  l("Asociaciones Composio", "Composio bindings"),
                  total?.confirmed,
                  l(
                    "Confirmadas y sin revisión pendiente",
                    "Confirmed with no stale review",
                  ),
                ],
                [
                  l("Mensajes en CRM", "Messages in CRM"),
                  total?.messages,
                  l(
                    "Archivo y sincronización disponibles",
                    "Available archive and sync",
                  ),
                ],
              ].map(([label, value, note]) => (
                <div key={String(label)}>
                  <span>{label}</span>
                  <strong>
                    {loading ? "…" : number(value as number | null | undefined)}
                  </strong>
                  <small>{note}</small>
                </div>
              ))}
            </div>
            <section
              className="panel cx-accounts"
              aria-labelledby={`${id}-accounts`}
            >
              <div className="cx-heading">
                <div>
                  <h3 id={`${id}-accounts`}>
                    {l("Tus cuentas de correo", "Your email accounts")}
                  </h3>
                  <p>
                    {l(
                      "Gmail conectado y asociación Composio son estados diferentes.",
                      "Gmail connection and Composio binding are different statuses.",
                    )}
                  </p>
                </div>
                <button
                  className="button"
                  type="button"
                  disabled={loading || data.demo || !!initialSnapshot}
                  onClick={() => setRevision((v) => v + 1)}
                >
                  <RefreshCw size={15} />
                  {l("Actualizar resumen", "Refresh summary")}
                </button>
              </div>
              <label className="field cx-search">
                <span>
                  {l("Buscar cuenta o marca", "Search account or brand")}
                </span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={l(
                    "Correo, organización o marca…",
                    "Email, organization or brand…",
                  )}
                />
              </label>
              {error && (
                <p className="error-banner" role="alert">
                  {error}
                </p>
              )}
              {loading && (
                <p className="cx-empty" role="status">
                  {l(
                    "Consultando cuentas y sincronización…",
                    "Loading accounts and sync…",
                  )}
                </p>
              )}
              {!loading && snapshot && !accounts.length && (
                <div className="cx-empty">
                  <Mail size={28} />
                  <h4>
                    {l(
                      "Aún no hay cuentas registradas",
                      "No accounts registered yet",
                    )}
                  </h4>
                  <p>
                    {l(
                      "Empieza conectando tu primer correo en el formulario de abajo.",
                      "Start by connecting your first email in the form below.",
                    )}
                  </p>
                </div>
              )}
              {!loading && accounts.length > 0 && (
                <div
                  className="cx-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label={l(
                    "Cuentas, permisos y sincronización",
                    "Accounts, permissions and sync",
                  )}
                >
                  <table>
                    <thead>
                      <tr>
                        {[
                          l("Cuenta", "Account"),
                          "Gmail",
                          "Composio",
                          l("Registro en CRM", "CRM registration"),
                          l("Última sincronización", "Last sync"),
                          l("Mensajes en CRM", "Messages in CRM"),
                          l("Permisos", "Permissions"),
                        ].map((label) => (
                          <th scope="col" key={label}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((a) => (
                        <tr key={a.id}>
                          <th scope="row">
                            <strong>{a.email}</strong>
                            <small>
                              {a.brand ||
                                l(
                                  "Marca por revisar",
                                  "Brand pending review",
                                )}{" "}
                              · {a.organization}
                            </small>
                          </th>
                          <td>
                            <span
                              className={`cx-status ${a.status === "connected" ? "cx-good" : ""}`}
                            >
                              {a.status === "connected"
                                ? l("Conectado", "Connected")
                                : (
                                    {
                                      disconnected: l(
                                        "Desconectado",
                                        "Disconnected",
                                      ),
                                      restricted: l(
                                        "Restringido",
                                        "Restricted",
                                      ),
                                      error: l("Con error", "Error"),
                                    } as Record<string, string>
                                  )[a.status] || l("Por revisar", "Review")}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`cx-status ${a.association === "verified" && !a.association_stale ? "cx-good" : "cx-pending"}`}
                            >
                              {association(a.association, a.association_stale)}
                            </span>
                            <small>
                              {l("Asociación registrada", "Binding registered")}
                              : {date(a.association_at)}
                            </small>
                            <small>
                              {l("Revisión", "Review")}: {date(a.reviewed_at)}
                            </small>
                          </td>
                          <td>{date(a.registered_at)}</td>
                          <td>{date(a.synced_at)}</td>
                          <td className="cx-numeric">
                            {a.messages === null
                              ? l("No disponible", "Unavailable")
                              : number(a.messages)}
                          </td>
                          <td>
                            <details>
                              <summary>
                                {l("Ver permisos", "View permissions")}
                              </summary>
                              <p>
                                {l(
                                  "Tu sesión tiene permiso de remitente",
                                  "Your session has sender permission",
                                )}
                                :{" "}
                                {a.can_send === null
                                  ? l("No disponible", "Unavailable")
                                  : a.can_send
                                    ? l("Sí", "Yes")
                                    : l("No", "No")}
                              </p>
                              <small>
                                {l(
                                  "Permisos explícitos de remitente",
                                  "Explicit sender permissions",
                                )}
                              </small>
                              {a.permissions === null ? (
                                <p>{l("No disponibles", "Unavailable")}</p>
                              ) : !a.permissions.length ? (
                                <p>
                                  {l(
                                    "Sin asignaciones explícitas",
                                    "No explicit assignments",
                                  )}
                                </p>
                              ) : (
                                <ul>
                                  {a.permissions.map((p, i) => (
                                    <li key={i}>
                                      {p.name} ·{" "}
                                      {p.active
                                        ? p.can_send
                                          ? l(
                                              "Envío autorizado",
                                              "Sending allowed",
                                            )
                                          : l(
                                              "Envío no autorizado",
                                              "Sending not allowed",
                                            )
                                        : l(
                                            "Usuario inactivo",
                                            "Inactive user",
                                          )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <small>
                                {l("Composio", "Composio")}:{" "}
                                {association(
                                  a.association,
                                  a.association_stale,
                                )}
                              </small>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filtered.length && (
                    <p className="cx-empty">
                      {l("No hay cuentas que coincidan.", "No accounts match.")}
                    </p>
                  )}
                </div>
              )}
              <div className="cx-footnote">
                <Clock3 size={14} />
                <span>
                  {l(
                    "Las fechas corresponden al registro y las comprobaciones del CRM. La fecha de conexión externa no está disponible. Los mensajes cuentan registros archivados, no todo el buzón remoto.",
                    "Dates refer to CRM registration and checks. The external connection date is unavailable. Messages count archived records, not the entire remote mailbox.",
                  )}
                </span>
              </div>
            </section>
            <div ref={connect} className="cx-connect">
              <ComposioConnect
                locale={locale}
                allowed={allowed}
                demo={data.demo}
                accounts={data.accounts}
              />
            </div>
            <details className="cx-tools">
              <summary>
                <ShieldCheck size={17} />
                {l(
                  "Asociaciones, permisos y transporte",
                  "Bindings, permissions and transport",
                )}
              </summary>
              <div className="cx-tools-body">
                <Bindings
                  locale={locale}
                  allowed={allowed}
                  demo={data.demo}
                  accounts={data.accounts}
                />
                <Integrations
                  data={data}
                  locale={locale}
                  act={manage}
                  busy={busy}
                  area="access"
                />
                <MailTransportSettings
                  locale={locale}
                  allowed={allowed}
                  demo={data.demo}
                  accounts={data.accounts}
                />
              </div>
            </details>
            <details className="cx-tools">
              <summary>
                <Mail size={17} />
                {l(
                  "Histórico y sincronización de Gmail",
                  "Gmail history and sync",
                )}
              </summary>
              <div className="cx-tools-body">
                <p className="muted">
                  {l(
                    "El histórico conserva su conexión Gmail y sus revisiones actuales.",
                    "History retains its current Gmail connection and review controls.",
                  )}
                </p>
                <GmailHistory
                  workspace={data}
                  locale={locale}
                  openCase={openCase}
                />
                {!data.gmail_history_enabled && connectLegacy && (
                  <button
                    type="button"
                    className="button"
                    onClick={connectLegacy}
                  >
                    {l("Conectar Google Workspace", "Connect Google Workspace")}
                  </button>
                )}
              </div>
            </details>
          </div>
        )}
      </section>
      <section
        className="cx-panel"
        role="tabpanel"
        aria-labelledby={`${id}-instantly`}
        id={`${id}-instantly-panel`}
        hidden={tab !== "instantly"}
        inert={tab !== "instantly"}
      >
        <div className="cx-heading">
          <div>
            <h2>Instantly</h2>
            <p>
              {l(
                "Configuración y controles de la integración existente.",
                "Existing integration configuration and controls.",
              )}
            </p>
          </div>
        </div>
        <div className="panel cx-provider-state">
          <span className="cx-provider-icon cx-instantly">
            <Zap size={26} />
          </span>
          <div>
            <h3>
              {snapshot
                ? snapshot.instantly.configuration_present
                  ? l("Configuración detectada", "Configuration detected")
                  : l(
                      "Sin configuración detectable",
                      "No configuration detected",
                    )
                : l("Estado no disponible", "Status unavailable")}
            </h3>
            <p>
              {l(
                "La presencia de configuración no acredita una conexión activa. El estado remoto y las cuentas de Instantly todavía no se muestran en este módulo.",
                "Configuration presence does not verify an active connection. Remote status and Instantly accounts are not yet shown in this module.",
              )}
            </p>
          </div>
          <span className="cx-status cx-pending">
            {l("Conexión por comprobar", "Connection unverified")}
          </span>
        </div>
        <InstantlyTrialControl allowed={allowed && !data.demo} />
        {data.demo && (
          <p className="cx-notice">
            {l(
              "Los controles de ensayo no operan en la demo.",
              "Trial controls do not run in demo mode.",
            )}
          </p>
        )}
      </section>
      <section
        className="cx-panel"
        role="tabpanel"
        aria-labelledby={`${id}-texttorrent`}
        id={`${id}-texttorrent-panel`}
        hidden={tab !== "texttorrent"}
        inert={tab !== "texttorrent"}
      >
        <div className="panel cx-placeholder">
          <span className="cx-provider-icon cx-texttorrent">
            <MessageSquare size={30} />
          </span>
          <span className="cx-status cx-pending">
            {l("Integración pendiente", "Integration pending")}
          </span>
          <h2>TextTorrent</h2>
          <p>
            {l(
              "Este será el espacio para gestionar las conexiones de SMS. La integración todavía no está implementada.",
              "This will be the place to manage SMS connections. The integration is not implemented yet.",
            )}
          </p>
          <div>
            <CheckCircle2 size={17} />
            {l(
              "Pestaña reservada para este proveedor",
              "Provider tab reserved",
            )}
          </div>
          <p className="muted">
            {l(
              "Aún no hay datos de cuentas, líneas ni permisos disponibles para consultar.",
              "Account, line and permission data is not available yet.",
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
