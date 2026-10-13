"use client";
import type { Locale } from "@/lib/domain";
import type { MailDateOrder } from "@/lib/mail-chat";
import { t } from "./ui";

export function MailOrder({
  locale,
  value,
  onChange,
}: {
  locale: Locale;
  value: MailDateOrder;
  onChange: (order: MailDateOrder) => void;
}) {
  return (
    <label className="field mail-date-order">
      {t(locale, "Orden por fecha", "Date order")}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as MailDateOrder)}
      >
        <option value="newest">
          {t(locale, "Más recientes primero", "Newest first")}
        </option>
        <option value="oldest">
          {t(locale, "Más antiguos primero", "Oldest first")}
        </option>
      </select>
    </label>
  );
}
