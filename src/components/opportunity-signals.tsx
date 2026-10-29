import { Building2, CircleCheck, FileText, Mail, Send } from "lucide-react";
import type { Locale } from "@/lib/domain";
import {
  elapsedSend,
  type OpportunitySignals,
} from "@/lib/opportunity-signals";
import { t } from "./ui";
import "./opportunity-signals.css";

export function LastOpportunitySend({
  value,
  locale,
  label,
  lender = false,
}: {
  value: string | null;
  locale: Locale;
  label: string;
  lender?: boolean;
}) {
  const exact = value
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : undefined;
  return (
    <div className={`opportunity-last-send ${value ? "has-send" : "no-send"}`}>
      {lender ? (
        <Send size={14} aria-hidden="true" />
      ) : (
        <Mail size={14} aria-hidden="true" />
      )}
      <span className="opportunity-send-label">{label}</span>
      {value ? (
        <time
          dateTime={value}
          title={exact}
          aria-label={`${label}: ${elapsedSend(value, locale)} · ${exact}`}
        >
          {elapsedSend(value, locale)}
        </time>
      ) : (
        <span>{t(locale, "Sin envíos", "No sends")}</span>
      )}
    </div>
  );
}

export function OpportunityDocuments({
  count,
  locale,
}: {
  count: number;
  locale: Locale;
}) {
  return (
    <span
      className={`opportunity-documents ${count ? "has-documents" : ""}`}
      title={t(
        locale,
        "Archivos cargados; la aprobación se revisa en Documentos",
        "Uploaded files; approval is reviewed in Documents",
      )}
    >
      {count ? (
        <CircleCheck size={17} aria-hidden="true" />
      ) : (
        <FileText size={17} aria-hidden="true" />
      )}
      <span>
        {count
          ? t(
              locale,
              `${count} cargado${count === 1 ? "" : "s"}`,
              `${count} uploaded`,
            )
          : t(locale, "Sin documentos", "No documents")}
      </span>
    </span>
  );
}

export function OpportunityLenders({
  count,
  locale,
}: {
  count: number;
  locale: Locale;
}) {
  return (
    <span
      className="opportunity-lender-count"
      title={t(
        locale,
        "Lenders distintos con envío o presentación registrada",
        "Distinct lenders with a recorded send or submission",
      )}
    >
      <Building2 size={16} aria-hidden="true" />
      <strong>{count}</strong>
      <span>{t(locale, "enviados", "sent")}</span>
    </span>
  );
}

export function OpportunitySignalSummary({
  signals,
  locale,
}: {
  signals: OpportunitySignals;
  locale: Locale;
}) {
  return (
    <section
      className="opportunity-signal-summary"
      aria-label={t(
        locale,
        "Seguimiento de la oportunidad",
        "Opportunity follow-up",
      )}
    >
      <div>
        <span>
          {t(locale, "Último envío al cliente", "Last send to client")}
        </span>
        <LastOpportunitySend
          value={signals.lastClientSentAt}
          label={t(locale, "Cliente", "Client")}
          locale={locale}
        />
      </div>
      <div>
        <span>{t(locale, "Último envío a lender", "Last send to lender")}</span>
        <LastOpportunitySend
          value={signals.lastLenderSentAt}
          label="Lender"
          locale={locale}
          lender
        />
      </div>
      <div>
        <span>{t(locale, "Documentos", "Documents")}</span>
        <OpportunityDocuments count={signals.documentCount} locale={locale} />
      </div>
      <div>
        <span>{t(locale, "Lenders contactados", "Lenders contacted")}</span>
        <OpportunityLenders count={signals.lenderCount} locale={locale} />
      </div>
    </section>
  );
}
