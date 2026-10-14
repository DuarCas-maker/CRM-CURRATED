"use client";

import { useState, type ReactNode } from "react";
import { Landmark, Search } from "lucide-react";
import type { Workspace, Locale } from "@/lib/domain";
import { lenderPortalUrl } from "@/lib/lender-directory";
import { Empty, t } from "./ui";

const normalize = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function LenderDirectory({
  data,
  locale,
  canEdit,
  edit,
  guidelines,
  children,
}: {
  data: Workspace;
  locale: Locale;
  canEdit: boolean;
  edit: (id: string) => void;
  guidelines?: (id: string) => void;
  children?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("all");
  const [product, setProduct] = useState("all");
  const products = [
    ...new Set(data.lenders.flatMap((lender) => lender.products)),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, locale));
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const lenders = data.lenders.filter((lender) => {
    const contacts = (data.lender_contacts || []).filter(
      (contact) => contact.lender_id === lender.id,
    );
    const text = normalize(
      [
        lender.name,
        lender.email,
        ...contacts.flatMap((c) => [c.name || "", c.email]),
      ].join(" "),
    );
    return (
      terms.every((term) => text.includes(term)) &&
      (channel === "all" || lender.channel === channel) &&
      (product === "all" || lender.products.includes(product))
    );
  });
  const hasFilters = query !== "" || channel !== "all" || product !== "all";

  return (
    <>
      <div className="panel lender-directory-filters">
        <label className="input-icon">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={t(locale, "Buscar lenders", "Search lenders")}
            placeholder={t(
              locale,
              "Buscar empresa, contacto o correo…",
              "Search company, contact or email…",
            )}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label={t(locale, "Filtrar por canal", "Filter by channel")}
          value={channel}
          onChange={(event) => setChannel(event.target.value)}
        >
          <option value="all">
            {t(locale, "Todos los canales", "All channels")}
          </option>
          <option value="email">Email</option>
          <option value="portal">Portal</option>
        </select>
        <select
          aria-label={t(locale, "Filtrar por producto", "Filter by product")}
          value={product}
          onChange={(event) => setProduct(event.target.value)}
        >
          <option value="all">
            {t(locale, "Todos los productos", "All products")}
          </option>
          {products.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            className="button"
            onClick={() => {
              setQuery("");
              setChannel("all");
              setProduct("all");
            }}
          >
            {t(locale, "Limpiar filtros", "Clear filters")}
          </button>
        )}
        <span className="lender-directory-count" role="status">
          {t(
            locale,
            `${lenders.length} de ${data.lenders.length} lenders`,
            `${lenders.length} of ${data.lenders.length} lenders`,
          )}
        </span>
      </div>
      {children}
      <div className="lender-grid">
        {lenders.map((lender) => {
          const portal = lenderPortalUrl(lender.notes);
          const contacts = (data.lender_contacts || []).filter(
            (c) => c.lender_id === lender.id,
          );
          return (
            <section className="panel lender-card" key={lender.id}>
              <div className="lender-logo">
                <Landmark size={24} />
              </div>
              <h2>{lender.name}</h2>
              <p>
                {contacts.length}{" "}
                {t(locale, "contactos / correos", "contacts / emails")} · Tier{" "}
                {lender.guidelines?.tier || "?"} ·{" "}
                {lender.guidelines?.verified
                  ? t(locale, "Guidelines confirmados", "Confirmed guidelines")
                  : t(
                      locale,
                      "Guidelines sin confirmar",
                      "Unconfirmed guidelines",
                    )}
              </p>
              <div className="product-tags">
                {lender.products.map((value) => (
                  <span key={value}>{value}</span>
                ))}
              </div>
              <dl>
                <dt>
                  {t(locale, "Canal de presentación", "Submission channel")}
                </dt>
                <dd>{lender.channel}</dd>
                <dt>{t(locale, "Contacto", "Contact")}</dt>
                <dd>
                  {lender.email ||
                    t(locale, "Sin correo de contacto", "No contact email")}
                </dd>
                {lender.channel === "portal" && portal && (
                  <>
                    <dt>Portal</dt>
                    <dd>
                      <a
                        href={portal}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t(locale, "Abrir portal", "Open portal")}
                      </a>
                    </dd>
                  </>
                )}
              </dl>
              <p>{lender.notes}</p>
              {contacts.length > 0 && (
                <details>
                  <summary>
                    {t(locale, "Ver contactos", "View contacts")}
                  </summary>
                  {contacts.map((c) => (
                    <p key={c.email}>
                      {c.name || "—"} · {c.email}
                    </p>
                  ))}
                </details>
              )}
              {guidelines && (
                <button
                  className="button"
                  onClick={() => guidelines(lender.id)}
                >
                  Guidelines v{lender.guideline_version || 0}
                </button>
              )}
              {canEdit && (
                <button className="button" onClick={() => edit(lender.id)}>
                  {t(locale, "Editar lender", "Edit lender")}
                </button>
              )}
            </section>
          );
        })}
      </div>
      {!lenders.length && (
        <Empty
          title={t(
            locale,
            hasFilters
              ? "No hay lenders con estos filtros"
              : "No hay lenders registrados",
            hasFilters
              ? "No lenders match these filters"
              : "No lenders registered",
          )}
          body={t(
            locale,
            hasFilters
              ? "Cambia la búsqueda o limpia los filtros para ver el directorio."
              : "Añade una empresa para empezar a gestionar sus contactos.",
            hasFilters
              ? "Change the search or clear the filters to see the directory."
              : "Add a company to start managing its contacts.",
          )}
        />
      )}
    </>
  );
}
