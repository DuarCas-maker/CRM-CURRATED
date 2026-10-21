"use client";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Search, Users } from "lucide-react";
import type { Locale } from "@/lib/domain";
import type {
  CampaignReadiness,
  CampaignReadinessFilter,
} from "@/lib/campaign-center";
import { audienceReasons } from "@/lib/campaign-delivery";
import { t } from "./ui";

export function CampaignReadinessPanel({
  locale,
  demo,
  revision,
}: {
  locale: Locale;
  demo: boolean;
  revision: unknown;
}) {
  const [result, setResult] = useState<CampaignReadiness | null>(null);
  const [expanded, setExpanded] = useState(false),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState<CampaignReadinessFilter>("eligible"),
    [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (demo) return;
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void fetch(
        "/api/campaigns/center?" +
          new URLSearchParams({
            mode: "readiness",
            search: query,
            filter,
            page: String(page),
          }),
        { signal: abort.signal, cache: "no-store" },
      )
        .then(async (response) => {
          const value = await response.json();
          if (!response.ok) throw new Error(value.error);
          if (!abort.signal.aborted) {
            setResult(value);
            setError("");
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [demo, query, filter, page, revision]);
  const summary = result?.summary;
  const count = (value: number | undefined) =>
    demo || value === undefined ? "—" : value.toLocaleString(locale);
  const choose = (state: CampaignReadinessFilter) => {
    setFilter(state);
    setPage(0);
    setExpanded(true);
  };
  const metrics = [
    [
      "preparing",
      "En preparación",
      "In preparation",
      summary?.preparing,
      "preparing",
    ],
    [
      "converted",
      "Convertidos a oportunidades",
      "Converted to opportunities",
      summary?.converted,
      "converted",
    ],
    [
      "eligible",
      "Disponibles para primer contacto",
      "Available for first contact",
      summary?.eligible,
      "eligible",
    ],
    [
      "sent",
      "Ya enviados por campañas",
      "Already sent by campaigns",
      summary?.sent,
      "sent",
    ],
    [
      "reserved",
      "Reservados en campañas",
      "Reserved in campaigns",
      summary?.reserved,
      "reserved",
    ],
  ] as const;
  return (
    <section
      className="campaign-readiness campaign-panel"
      aria-labelledby="campaign-readiness-title"
    >
      <div className="campaign-readiness-heading">
        <div>
          <span className="campaign-eyebrow">
            {t(
              locale,
              "PREPARACIÓN → OPORTUNIDADES → CAMPAÑAS",
              "PREPARATION → OPPORTUNITIES → CAMPAIGNS",
            )}
          </span>
          <h2 id="campaign-readiness-title">
            <Users size={16} />
            {t(
              locale,
              "¿A cuántos contactos puedes escribir?",
              "How many contacts can you email?",
            )}
          </h2>
        </div>
        <button
          className="button"
          aria-expanded={expanded}
          aria-controls="campaign-readiness-contacts"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? t(locale, "Ocultar contactos", "Hide contacts")
            : t(locale, "Ver contactos", "View contacts")}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      <div className="campaign-readiness-counts" aria-live="polite">
        {metrics.map(([key, es, en, value, state]) => (
          <button
            key={key}
            className={key === "eligible" ? "highlight" : ""}
            onClick={() => choose(state)}
          >
            <strong>{count(value)}</strong>
            <span>{t(locale, es, en)}</span>
          </button>
        ))}
      </div>
      <p className="campaign-readiness-note">
        {t(
          locale,
          "Solo leads validados, convertidos y sin exclusiones. La plantilla elegida puede exigir datos adicionales. Los contactos disponibles y el cupo de Gmail son cantidades distintas.",
          "Only validated, converted leads without exclusions. The selected template may require additional fields. Available contacts and Gmail budget are different counts.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!error && summary && (
        <div className="campaign-readiness-meta">
          <span>
            {count(summary.total)}{" "}
            {t(locale, "leads visibles", "visible leads")} ·{" "}
            {count(summary.excluded)}{" "}
            {t(locale, "aún no elegibles", "not yet eligible")}
          </span>
          <button onClick={() => choose("excluded")}>
            {t(locale, "Ver motivos de exclusión", "View exclusion reasons")} →
          </button>
        </div>
      )}
      {demo && (
        <p className="campaign-readiness-note">
          {t(
            locale,
            "Los conteos reales se consultan al iniciar sesión en el CRM.",
            "Sign in to the CRM to load actual counts.",
          )}
        </p>
      )}
      {!demo && summary?.authorized_senders === 0 && (
        <p className="campaign-note">
          {t(
            locale,
            "Necesitas una cuenta Gmail conectada y permiso de envío para activar una campaña.",
            "A connected Gmail account and sending permission are required to activate a campaign.",
          )}
        </p>
      )}
      {expanded && (
        <div
          id="campaign-readiness-contacts"
          className="campaign-readiness-body"
        >
          <div className="campaign-tools">
            <label className="campaign-search">
              <Search size={14} />
              <input
                value={query}
                aria-label={t(
                  locale,
                  "Buscar leads disponibles para campañas",
                  "Search leads available for campaigns",
                )}
                placeholder={t(
                  locale,
                  "Empresa, contacto o correo…",
                  "Company, contact or email…",
                )}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <select
              aria-label={t(
                locale,
                "Disponibilidad de contactos",
                "Contact availability",
              )}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as CampaignReadinessFilter);
                setPage(0);
              }}
            >
              {[
                ["preparing", "En preparación", "In preparation"],
                [
                  "converted",
                  "Convertidos a oportunidades",
                  "Converted to opportunities",
                ],
                ["eligible", "Disponibles", "Available"],
                [
                  "sent",
                  "Ya enviados por campañas",
                  "Already sent by campaigns",
                ],
                ["reserved", "Reservados en campañas", "Reserved in campaigns"],
                ["excluded", "No elegibles", "Not eligible"],
                ["all", "Todos los leads", "All leads"],
              ].map(([value, es, en]) => (
                <option key={value} value={value}>
                  {t(locale, es, en)}
                </option>
              ))}
            </select>
          </div>
          {filter === "excluded" && summary && (
            <div className="campaign-reasons">
              {Object.entries(summary.reasons)
                .filter(([key]) => key !== "eligible")
                .map(([key, n]) => (
                  <span key={key}>
                    {
                      (audienceReasons[key] || [key, key])[
                        locale === "es" ? 0 : 1
                      ]
                    }
                    : {n.toLocaleString(locale)}
                  </span>
                ))}
            </div>
          )}
          <div className="campaign-table-scroll" aria-busy={loading}>
            <table className="campaign-table campaign-readiness-table">
              <thead>
                <tr>
                  {[
                    ["Empresa", "Company"],
                    ["Contacto", "Contact"],
                    ["Correo", "Email"],
                    ["Estado para campañas", "Campaign readiness"],
                  ].map(([es, en]) => (
                    <th key={es}>{t(locale, es, en)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!loading &&
                  result?.rows.map((row) => (
                    <tr key={row.contact_id}>
                      <td>
                        <strong>{row.company}</strong>
                      </td>
                      <td>{row.name || "—"}</td>
                      <td>{row.email}</td>
                      <td>
                        <span
                          className={`campaign-badge ${row.sent ? "sent" : row.reason === "eligible" ? "active" : ""}`}
                        >
                          {row.sent
                            ? t(
                                locale,
                                "Envío inicial confirmado",
                                "Initial send confirmed",
                              )
                            : row.reserved
                              ? t(
                                  locale,
                                  "Reservado en otra campaña",
                                  "Reserved in another campaign",
                                )
                              : (audienceReasons[row.reason] || [
                                  row.reason,
                                  row.reason,
                                ])[locale === "es" ? 0 : 1]}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {loading ? (
              <p className="campaign-readiness-note" role="status">
                {t(locale, "Consultando contactos…", "Loading contacts…")}
              </p>
            ) : (
              !result?.rows.length && (
                <p className="campaign-readiness-note">
                  {t(
                    locale,
                    "No hay contactos en este filtro.",
                    "No contacts match this filter.",
                  )}
                </p>
              )
            )}
          </div>
          <div className="campaign-pagination">
            <small>
              {count(result?.total)} {t(locale, "resultados", "results")} ·{" "}
              {page + 1}/{Math.max(1, Math.ceil((result?.total || 0) / 50))}
            </small>
            <button
              className="button"
              aria-label={t(
                locale,
                "Página anterior de contactos disponibles",
                "Previous available contacts page",
              )}
              disabled={loading || page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              ←
            </button>
            <button
              className="button"
              aria-label={t(
                locale,
                "Página siguiente de contactos disponibles",
                "Next available contacts page",
              )}
              disabled={loading || (page + 1) * 50 >= (result?.total || 0)}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
