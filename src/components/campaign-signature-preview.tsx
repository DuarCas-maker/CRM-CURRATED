"use client";
import { useEffect, useState } from "react";
import type { Locale, MailAccount } from "@/lib/domain";
import { accountPreparation } from "@/lib/brand-delivery";
import { messagePreviewDocument } from "@/lib/lender-templates";
import { t } from "./ui";

export function CampaignSignaturePreview({
  account,
  locale,
}: {
  account?: MailAccount;
  locale: Locale;
}) {
  const key = JSON.stringify({
    account_id: account?.id,
    brand_preparation: accountPreparation(account),
  });
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    key: string;
    html?: string;
    error?: boolean;
  }>({ key: "" });
  useEffect(() => {
    if (!account?.id) return;
    const controller = new AbortController();
    setState({ key });
    void fetch("/api/campaigns/signature", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: key,
      signal: controller.signal,
    })
      .then(async (r) => {
        const value = await r.json();
        if (
          !r.ok ||
          typeof value.html !== "string" ||
          value.email !== account.email
        )
          throw Error("SIGNATURE_UNAVAILABLE");
        if (!controller.signal.aborted) setState({ key, html: value.html });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, error: true });
      });
    return () => controller.abort();
  }, [key, retry]);
  const current = state.key === key ? state : { key };
  return (
    <section
      className="campaign-signature-preview"
      aria-label={t(
        locale,
        "Firma automática del remitente",
        "Automatic sender signature",
      )}
    >
      <small>
        {t(locale, "Firma de Gmail", "Gmail signature")} ·{" "}
        {account?.email || "—"}
      </small>
      {!account ? (
        <p>
          {t(
            locale,
            "Selecciona una cuenta para ver su firma.",
            "Select an account to see its signature.",
          )}
        </p>
      ) : current.error ? (
        <p role="status">
          {t(
            locale,
            "No se pudo cargar la firma de esta cuenta.",
            "Could not load this account's signature.",
          )}{" "}
          <button
            type="button"
            className="button"
            onClick={() => setRetry((n) => n + 1)}
          >
            {t(locale, "Reintentar", "Retry")}
          </button>
        </p>
      ) : current.html === undefined ? (
        <p role="status">
          {t(locale, "Cargando firma…", "Loading signature…")}
        </p>
      ) : current.html ? (
        <iframe
          title={t(
            locale,
            "Firma de la cuenta seleccionada",
            "Selected account signature",
          )}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={messagePreviewDocument(current.html)}
        />
      ) : (
        <p role="status">
          {t(
            locale,
            "Esta cuenta no tiene firma en Gmail. Configúrala allí para incluirla en tus correos.",
            "This account has no Gmail signature. Configure it in Gmail to include it in your emails.",
          )}
        </p>
      )}
    </section>
  );
}
