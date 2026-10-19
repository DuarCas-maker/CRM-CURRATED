"use client";
import { ProtectedForm } from "./unsaved-changes";
import { useState } from "react";
import type { Workspace, Locale } from "@/lib/domain";
import { roleLabels, dateLabel } from "@/lib/domain";
import type { Action } from "./crm";
import { Modal, Field, SaveButton, t, Empty } from "./ui";
import { GmailHistory } from "./gmail-history";
export function Integrations({
  data,
  locale,
  act,
  busy,
  openCase,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  busy: boolean;
  openCase?: (id: string) => void;
}) {
  const [modal, setModal] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [accountId, setAccountId] = useState(data.accounts[0]?.id || "");
  const account = data.accounts.find((a) => a.id === accountId);
  const [selectedCase, setSelectedCase] = useState(
    data.opportunities[0]?.id || "",
  );
  async function submit(
    e: React.FormEvent<HTMLFormElement>,
    kind: string,
    extra: Record<string, unknown> = {},
  ) {
    e.preventDefault();
    setError("");
    try {
      await act(kind, {
        ...Object.fromEntries(new FormData(e.currentTarget)),
        ...extra,
      });
      setModal(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <GmailHistory workspace={data} locale={locale} openCase={openCase} />
      <section className="panel settings-panel">
        <h2>
          {t(locale, "Administración de accesos", "Access administration")}
        </h2>
        <div className="card-actions">
          <button className="button" onClick={() => setModal("permissions")}>
            {t(locale, "Permisos de remitentes", "Sender permissions")}
          </button>
          <button className="button" onClick={() => setModal("role")}>
            {t(locale, "Roles del equipo", "Team roles")}
          </button>
          <button className="button" onClick={() => setModal("account")}>
            {t(locale, "Límites de envío", "Sending limits")}
          </button>
        </div>
      </section>
      <section className="panel settings-panel">
        <h2>
          {t(locale, "Asociaciones por revisar", "Associations to review")}
        </h2>
        {(data.mail_review || [])
          .filter((r) => r.status === "pending")
          .map((r) => (
            <div className="document-row" key={r.id}>
              <div>
                <strong>
                  {data.accounts.find((a) => a.id === r.account_id)?.email}
                </strong>
                <small>{r.reason}</small>
              </div>
              <button
                className="button"
                onClick={() => setModal(`review:${r.id}`)}
              >
                {t(locale, "Revisar", "Review")}
              </button>
            </div>
          ))}
        {!data.mail_review?.some((r) => r.status === "pending") && (
          <p className="muted">
            {t(
              locale,
              "No hay hilos ambiguos pendientes.",
              "No ambiguous threads are pending.",
            )}
          </p>
        )}
      </section>
      <section className="panel settings-panel">
        <h2>
          {t(locale, "Trabajos e integraciones", "Jobs and integrations")}
        </h2>
        {(data.integration_jobs || [])
          .filter((j) =>
            ["failed", "paused", "running", "queued"].includes(j.status),
          )
          .slice(0, 20)
          .map((j) => (
            <div className="account-row" key={j.id}>
              <div>
                <strong>{j.kind}</strong>
                <small>
                  {dateLabel(j.created_at, locale, true)} · {j.attempts}{" "}
                  {t(locale, "intentos", "attempts")}
                </small>
              </div>
              <span className="badge">{j.status}</span>
            </div>
          ))}
        <p className="muted">
          {t(
            locale,
            "Los errores no cambian el resultado del scrub a inválido. Los envíos inciertos requieren conciliación.",
            "Errors do not turn a verification result into invalid. Uncertain sends require reconciliation.",
          )}
        </p>
        {(data.outbox_status || [])
          .filter((o) => ["uncertain", "paused", "failed"].includes(o.status))
          .map((o) => (
            <div className="account-row" key={o.id}>
              <div>
                <strong>
                  {t(
                    locale,
                    "Envío pendiente de revisión",
                    "Send awaiting review",
                  )}
                </strong>
                <small>{o.id}</small>
              </div>
              <span className="badge">{o.status}</span>
            </div>
          ))}
      </section>
      {modal && (
        <Modal
          busy={busy}
          locale={locale}
          title={t(locale, "Administración", "Administration")}
          close={() => {
            setModal(null);
            setError("");
          }}
        >
          {error && <div className="error-banner">{error}</div>}
          {modal === "permissions" && (
            <ProtectedForm
              busy={busy}
              onSubmit={(e) => {
                const form = new FormData(e.currentTarget);
                submit(e, "mail_permission", {
                  can_send: form.get("can_send") === "true",
                });
              }}
            >
              <Field name="account_id" label={t(locale, "Cuenta", "Account")}>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                  </option>
                ))}
              </Field>
              <Field name="user_id" label={t(locale, "Usuario", "User")}>
                {data.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Field>
              <Field
                name="can_send"
                label={t(locale, "Permiso de envío", "Sending permission")}
              >
                <option value="true">{t(locale, "Autorizar", "Allow")}</option>
                <option value="false">{t(locale, "Revocar", "Revoke")}</option>
              </Field>
              <p className="muted">
                {t(
                  locale,
                  "Este permiso no concede acceso a otros expedientes.",
                  "This permission does not grant access to other cases.",
                )}
              </p>
              <div className="modal-footer">
                <SaveButton locale={locale} busy={busy} />
              </div>
            </ProtectedForm>
          )}
          {modal === "role" && (
            <ProtectedForm
              busy={busy}
              onSubmit={(e) => {
                const form = new FormData(e.currentTarget);
                submit(e, "user_role", {
                  active: form.get("active") === "true",
                });
              }}
            >
              <Field name="user_id" label={t(locale, "Usuario", "User")}>
                {data.profiles
                  .filter((p) => p.id !== data.profile.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Field>
              <Field name="role" label={t(locale, "Rol", "Role")}>
                {Object.entries(roleLabels).map(([r, label]) => (
                  <option key={r} value={r}>
                    {label}
                  </option>
                ))}
              </Field>
              <Field name="active" label={t(locale, "Acceso", "Access")}>
                <option value="true">{t(locale, "Activo", "Active")}</option>
                <option value="false">
                  {t(locale, "Suspendido", "Suspended")}
                </option>
              </Field>
              <div className="modal-footer">
                <SaveButton locale={locale} busy={busy} />
              </div>
            </ProtectedForm>
          )}
          {modal === "account" && (
            <ProtectedForm
              busy={busy}
              key={accountId}
              onSubmit={(e) => submit(e, "campaign_account_settings")}
            >
              <label className="field">
                {t(locale, "Cuenta", "Account")}
                <select
                  name="id"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                name="daily_limit"
                label={t(
                  locale,
                  "Límite total por 24 horas",
                  "Total limit per 24 hours",
                )}
                type="number"
                value={account?.daily_limit || 100}
                min={1}
                max={2000}
                required
              />
              <Field
                name="campaign_daily_limit"
                label={t(
                  locale,
                  "Cupo compartido de campañas por 24 h",
                  "Shared campaign limit per 24h",
                )}
                type="number"
                value={Math.min(
                  account?.campaign_daily_limit || 100,
                  Math.max(
                    1,
                    (account?.daily_limit || 100) -
                      (account?.operational_reserve ?? 20),
                  ),
                )}
                min={1}
                max={2000}
                required
              />
              <Field
                name="operational_reserve"
                label={t(
                  locale,
                  "Reserva para correo operativo",
                  "Operational email reserve",
                )}
                type="number"
                value={account?.operational_reserve ?? 20}
                min={0}
                max={1999}
                required
              />
              <p className="muted">
                {t(
                  locale,
                  "Ventana móvil de 24 horas. El cupo de campañas más la reserva debe caber en el límite total. Los envíos externos también consumen el cupo de Google.",
                  "Rolling 24-hour window. Campaign limit plus reserve must fit within the total. External email also consumes Google's quota.",
                )}
              </p>
              <div className="modal-footer">
                <SaveButton locale={locale} busy={busy} />
              </div>
            </ProtectedForm>
          )}
          {modal.startsWith("review:") && (
            <ProtectedForm
              busy={busy}
              onSubmit={(e) =>
                submit(e, "associate_thread", {
                  id: modal.split(":")[1],
                  opportunity_id: selectedCase,
                })
              }
            >
              <label className="field">
                <span>{t(locale, "Oportunidad", "Opportunity")}</span>
                <select
                  value={selectedCase}
                  onChange={(e) => setSelectedCase(e.target.value)}
                >
                  {data.opportunities.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.company}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                name="submission_id"
                label={t(
                  locale,
                  "Solicitud a lender (obligatoria para lenders)",
                  "Lender submission (required for lenders)",
                )}
              >
                <option value="">
                  {t(locale, "Conversación con cliente", "Client conversation")}
                </option>
                {data.submissions
                  .filter((s) => s.opportunity_id === selectedCase)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {data.lenders.find((l) => l.id === s.lender_id)?.name} ·{" "}
                      {dateLabel(s.submitted_at, locale)}
                    </option>
                  ))}
              </Field>
              <p className="muted">
                {t(
                  locale,
                  "La asociación se registra en auditoría. Los adjuntos necesitan revisión separada.",
                  "The association is audited. Attachments require a separate review.",
                )}
              </p>
              <div className="modal-footer">
                <SaveButton locale={locale} busy={busy} />
              </div>
            </ProtectedForm>
          )}
        </Modal>
      )}
    </>
  );
}
