"use client";
import { useState } from "react";
import type { Workspace, Locale } from "@/lib/domain";
import type { Action } from "./crm";
import { t, SaveButton } from "./ui";
export function LenderContacts({
  data,
  locale,
  act,
  busy,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  busy: boolean;
}) {
  const [lender, setLender] = useState(data.lenders[0]?.id || ""),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  return (
    <section className="panel settings-panel">
      <h2>{t(locale, "Correos de cada lender", "Lender email addresses")}</h2>
      <p>
        {t(
          locale,
          "Los contactos de una empresa comparten conversación por proceso. Los correos de su dominio propio se reconocen automáticamente; los proveedores de correo compartidos requieren una dirección registrada.",
          "Company contacts share a conversation per process. Addresses on its own domain are recognized automatically; shared email providers require a registered address.",
        )}
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <label className="field">
        Lender
        <select value={lender} onChange={(e) => setLender(e.target.value)}>
          {data.lenders.map((l) => (
            <option value={l.id} key={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      {(data.lender_contacts || [])
        .filter((c) => c.lender_id === lender)
        .map((c) => (
          <p key={c.email}>
            {c.name ? `${c.name} · ` : ""}
            {c.email}
          </p>
        ))}
      {["superadmin", "closer_admin", "closer"].includes(data.profile.role) && (
        <form
          className="gmail-connect-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await act("lender_contact", {
                lender_id: lender,
                email: email.trim(),
                name: name.trim(),
              });
              setEmail("");
              setName("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label>
            {t(locale, "Nombre del contacto", "Contact name")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={150}
            />
          </label>
          <label>
            {t(locale, "Correo del empleado", "Employee email")}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
            />
          </label>
          <SaveButton
            busy={busy}
            locale={locale}
            disabled={!lender}
            label={t(locale, "Confirmar correo", "Confirm email")}
          />
        </form>
      )}
    </section>
  );
}
