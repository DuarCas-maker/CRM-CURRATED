"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Search, Check, LoaderCircle } from "lucide-react";
import type { Locale, Opportunity } from "@/lib/domain";
import { t } from "./ui";

export type MailClientChoice = Pick<
  Opportunity,
  "id" | "contact" | "company" | "email"
>;
export function MailClientPicker({
  selected,
  initial,
  locale,
  demo,
  locked,
  onSelect,
}: {
  selected?: MailClientChoice;
  initial: MailClientChoice[];
  locale: Locale;
  demo: boolean;
  locked?: boolean;
  onSelect: (client: MailClientChoice) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const [options, setOptions] = useState(initial),
    [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (demo) {
      setOptions(
        initial.filter((o) =>
          `${o.contact} ${o.company} ${o.email}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
      );
      setHasMore(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/conversations/clients?${new URLSearchParams({ q: query, page: String(page) })}`,
          { signal: controller.signal },
        );
        const result = await r.json();
        if (!r.ok) throw Error(result.error);
        if (!controller.signal.aborted) {
          setOptions((old) =>
            page
              ? [
                  ...new Map(
                    [...old, ...result.clients].map((o: MailClientChoice) => [
                      o.id,
                      o,
                    ]),
                  ).values(),
                ]
              : result.clients,
          );
          setHasMore(result.hasMore);
          setActive(0);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, page, demo, initial]);
  const choose = (client: MailClientChoice) => {
    onSelect(client);
    setOpen(false);
  };
  return (
    <div className="cw-client-picker" ref={container}>
      <button
        className="cw-client-button"
        type="button"
        disabled={locked}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!open);
          setQuery("");
          setPage(0);
        }}
      >
        <span className="cw-client-initials">
          {(selected?.contact || selected?.company || "?")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((s) => s[0])
            .join("")}
        </span>
        <span className="cw-client-selected">
          <strong>
            {selected?.contact ||
              selected?.company ||
              t(locale, "Seleccionar cliente", "Select customer")}
          </strong>
          <small>
            {selected
              ? `${selected.company} · ${selected.email}`
              : t(
                  locale,
                  "Buscar cliente, empresa o correo",
                  "Find customer, company or email",
                )}
          </small>
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div
          className="cw-client-popover"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (e.target !== input.current) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((n) => Math.min(options.length - 1, n + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((n) => Math.max(0, n - 1));
            }
            if (e.key === "Enter" && options[active]) {
              e.preventDefault();
              choose(options[active]);
            }
          }}
        >
          <label className="cw-client-search">
            <Search size={15} />
            <input
              ref={input}
              value={query}
              maxLength={150}
              role="combobox"
              aria-label={t(
                locale,
                "Buscar cliente, empresa o correo",
                "Search customer, company or email",
              )}
              aria-expanded={open}
              aria-controls={id}
              aria-activedescendant={
                options[active] ? `${id}-${options[active].id}` : undefined
              }
              placeholder={t(
                locale,
                "Nombre, empresa o correo…",
                "Name, company or email…",
              )}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {loading && (
            <p className="cw-small-status" role="status">
              <LoaderCircle size={13} className="spin" />
              {t(locale, "Buscando…", "Searching…")}
            </p>
          )}
          {error && (
            <p className="cw-inline-error" role="alert">
              {error}
            </p>
          )}
          <div
            className="cw-client-options"
            role="listbox"
            id={id}
            aria-label={t(locale, "Clientes", "Customers")}
          >
            {options.map((client, i) => (
              <button
                key={client.id}
                type="button"
                id={`${id}-${client.id}`}
                role="option"
                aria-selected={selected?.id === client.id}
                className={i === active ? "focused" : ""}
                onClick={() => choose(client)}
              >
                <span>
                  <strong>{client.contact || client.company}</strong>
                  <small>{client.company}</small>
                  <small>{client.email}</small>
                </span>
                {selected?.id === client.id && <Check size={14} />}
              </button>
            ))}
            {!loading && !options.length && (
              <p className="cw-small-status">
                {t(
                  locale,
                  "Sin clientes coincidentes",
                  "No matching customers",
                )}
              </p>
            )}
          </div>
          {hasMore && (
            <button
              className="cw-link"
              type="button"
              disabled={loading}
              onClick={() => setPage((p) => p + 1)}
            >
              {t(locale, "Cargar más clientes", "Load more customers")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
