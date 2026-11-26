import type { Locale } from "@/lib/domain";
import {
  incomeLabel,
  type IncomeFilter,
  type IncomeSummary,
} from "@/lib/campaign-readiness";
import { t } from "../ui";
export function IncomeStatus({
  value,
  locale,
}: {
  value: number | null | undefined;
  locale: Locale;
}) {
  return (
    <span
      className="cf-income-status"
      data-income={
        value === undefined
          ? "unknown"
          : value !== null && value > 0
            ? "present"
            : "missing"
      }
    >
      {incomeLabel(value, locale)}
    </span>
  );
}
export function IncomeOverview({
  summary,
  locale,
}: {
  summary?: IncomeSummary;
  locale: Locale;
}) {
  const n = (value?: number) =>
    value === undefined
      ? "—"
      : value.toLocaleString(locale === "es" ? "es-CO" : "en-US");
  return (
    <div
      className="cf-income-overview"
      aria-label={t(
        locale,
        "Estado del ingreso mensual",
        "Monthly income status",
      )}
    >
      <strong>{t(locale, "Ingreso mensual", "Monthly income")}</strong>
      {(["all", "available"] as const).map((scope) => (
        <span key={scope}>
          {scope === "all"
            ? t(locale, "Total de leads", "All leads")
            : t(locale, "Disponibles", "Available")}
          : <b>{n(summary?.[scope].with_income)}</b>{" "}
          {t(locale, "con ingreso", "with income")} ·{" "}
          <b>{n(summary?.[scope].without_income)}</b>{" "}
          {t(locale, "sin ingreso", "missing income")}
        </span>
      ))}
    </div>
  );
}
export function IncomeSelector({
  value,
  change,
  disabled,
  locale,
}: {
  value: IncomeFilter;
  change: (value: IncomeFilter) => void;
  disabled?: boolean;
  locale: Locale;
}) {
  return (
    <label className="cc-field cf-income-selector">
      {t(locale, "Filtrar por ingreso mensual", "Filter by monthly income")}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => change(e.target.value as IncomeFilter)}
      >
        <option value="all">
          {t(
            locale,
            "Todos: con y sin ingreso",
            "All: with and without income",
          )}
        </option>
        <option value="with">
          {t(locale, "Con ingreso mensual", "With monthly income")}
        </option>
        <option value="without">
          {t(locale, "Sin ingreso mensual", "Missing monthly income")}
        </option>
      </select>
    </label>
  );
}
