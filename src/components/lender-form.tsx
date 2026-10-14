"use client";
import { useState, type FormEvent } from "react";
import type { Lender, Locale } from "@/lib/domain";
import { lenderPortalNotes, lenderPortalUrl } from "@/lib/lender-directory";
import { Field, SaveButton, t } from "./ui";

export function LenderForm({
  lender,
  locale,
  busy,
  submit,
}: {
  lender?: Lender;
  locale: Locale;
  busy: boolean;
  submit: (
    event: FormEvent<HTMLFormElement>,
    extras: Record<string, unknown>,
  ) => void;
}) {
  const [channel, setChannel] = useState(lender?.channel || "email");
  return (
    <form
      onSubmit={(event) => {
        const values = new FormData(event.currentTarget);
        submit(event, {
          channel,
          email: String(values.get("email") || "")
            .trim()
            .toLowerCase(),
          notes:
            channel === "portal"
              ? lenderPortalNotes(
                  String(values.get("notes") || ""),
                  String(values.get("portal_url") || ""),
                )
              : String(values.get("notes") || ""),
        });
      }}
    >
      <Field
        name="name"
        label={t(locale, "Nombre", "Name")}
        value={lender?.name}
        required
      />
      <label className="field">
        <span>{t(locale, "Canal", "Channel")}</span>
        <select
          name="channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          disabled={busy}
        >
          <option value="email">Email</option>
          <option value="portal">Portal</option>
        </select>
      </label>
      <Field
        name="email"
        label={
          channel === "portal"
            ? t(
                locale,
                "Correo de contacto (opcional)",
                "Contact email (optional)",
              )
            : "Email"
        }
        type="email"
        value={lender?.email}
        required={channel === "email"}
      />
      {channel === "portal" && (
        <Field
          name="portal_url"
          label={t(locale, "Enlace del portal", "Portal URL")}
          type="url"
          value={lenderPortalUrl(lender?.notes || "")}
          required
          placeholder="https://"
        />
      )}
      <Field
        name="products"
        label={t(
          locale,
          "Productos (separados por coma)",
          "Products (comma separated)",
        )}
        value={lender?.products.join(", ")}
      />
      <Field
        name="notes"
        label={t(locale, "Referencias y notas", "References and notes")}
        type="textarea"
        value={lender?.notes}
      />
      <div className="modal-footer">
        <SaveButton locale={locale} busy={busy} />
      </div>
    </form>
  );
}
