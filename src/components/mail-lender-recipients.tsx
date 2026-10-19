"use client";
import { useEffect, useId, useState } from "react";
import type { Locale, Workspace } from "@/lib/domain";
import {
  filterRecipientLenders,
  lenderContacts,
  recipientIssues,
  type RecipientDirectory,
  type RecipientSelection,
  type RecipientTarget,
} from "@/lib/mail-recipient-selections";
import { t } from "./ui";

const groupStyle = {
  minWidth: 0,
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: 12,
};
const actionStyle = { display: "flex", flexWrap: "wrap" as const, gap: 8 };

export function MailLenderRecipients({
  data,
  locale,
  locked,
  caseId,
  targets,
  copies,
  evaluations,
  targetEvaluations,
  process,
  onTargets,
  onCopies,
  onEvaluations,
  onValidity,
}: {
  data: Workspace;
  locale: Locale;
  locked: boolean;
  caseId: string;
  targets: Record<string, string>;
  copies: Record<string, string[]>;
  evaluations: { id: string; lender_id: string; process_id: string | null }[];
  targetEvaluations: Record<string, string>;
  process: string;
  onTargets: (value: Record<string, string>) => void;
  onCopies: (value: Record<string, string[]>) => void;
  onEvaluations: (value: Record<string, string>) => void;
  onValidity: (invalid: boolean) => void;
}) {
  const id = useId();
  const [directory, setDirectory] = useState<RecipientDirectory>({
    lenders: data.lenders,
    contacts: data.lender_contacts || [],
  });
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [scope, setScope] = useState<"filtered" | "all">("filtered");
  const [selections, setSelections] = useState<RecipientSelection[]>([]);
  const [savedId, setSavedId] = useState("");
  const [name, setName] = useState("");
  const [savedNames, setSavedNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const disabled = locked || working;
  useEffect(() => {
    setDirectory({
      lenders: data.lenders,
      contacts: data.lender_contacts || [],
    });
  }, [data.lenders, data.lender_contacts]);
  useEffect(() => {
    if (data.demo) return;
    const controller = new AbortController();
    fetch("/api/mail/recipient-selections", { signal: controller.signal })
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        setSelections(p.selections);
        setDirectory(p.directory);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [data.demo]);
  const recipientTargets: RecipientTarget[] = Object.entries(targets).map(
    ([lender_id, email]) => ({
      lender_id,
      email,
      cc_emails: (copies[lender_id] || []).filter(
        (c) => c.toLowerCase() !== email.toLowerCase(),
      ),
      lender_name:
        directory.lenders.find((l) => l.id === lender_id)?.name ||
        savedNames[lender_id] ||
        lender_id,
    }),
  );
  const issues = recipientIssues(recipientTargets, directory);
  const invalid =
    issues.length > 0 ||
    !recipientTargets.length ||
    recipientTargets.length > 20 ||
    recipientTargets.some((r) => r.cc_emails.length > 20);
  useEffect(() => {
    onValidity(invalid || working);
  }, [invalid, working, onValidity]);
  const filtered = filterRecipientLenders(directory, search, order, locale);
  const catalog = filterRecipientLenders(directory, "", order, locale);
  const affected = scope === "all" ? catalog : filtered;
  const scopeLabel =
    scope === "all"
      ? t(locale, "catálogo completo", "entire catalog")
      : t(locale, "resultado filtrado", "filtered results");

  function add(ids: string[]) {
    const next = { ...targets };
    ids.forEach((id) => {
      if (id in next) return;
      const contacts = lenderContacts(directory, id);
      const main = directory.lenders.find((l) => l.id === id)?.email;
      next[id] =
        contacts.find((c) => c.email === main)?.email ||
        contacts[0]?.email ||
        "";
    });
    if (Object.keys(next).length > 20) {
      setError(
        t(
          locale,
          "Máximo 20 lenders por envío. Reduce el resultado o la selección.",
          "Maximum 20 lenders per send. Narrow the results or selection.",
        ),
      );
      return;
    }
    setError("");
    onTargets(next);
  }
  function remove(ids: string[]) {
    const next = { ...targets };
    ids.forEach((id) => delete next[id]);
    onTargets(next);
  }
  async function request(body: object) {
    const r = await fetch("/api/mail/recipient-selections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const p = await r.json();
    if (!r.ok) throw Error(p.error);
    return p;
  }
  return (
    <section
      className={"mail-lender-recipients"}
      style={{ display: "grid", gap: 14, minWidth: 0 }}
      aria-label={t(locale, "Destinatarios lenders", "Lender recipients")}
    >
      <p>
        {t(
          locale,
          "Cada lender recibirá un correo independiente. Los contactos en CC pertenecen únicamente a esa empresa.",
          "Each lender receives a separate email. CC contacts belong only to that company.",
        )}
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={disabled} style={groupStyle}>
        <legend>
          {t(
            locale,
            "Selecciones personales de destinatarios",
            "Personal recipient selections",
          )}
        </legend>
        <p className="muted">
          {t(
            locale,
            "Solo guardan lenders, destinatarios principales y CC; son distintas de las plantillas de asunto y mensaje. Aplicarlas prepara el formulario y nunca envía correos.",
            "These save only lenders, primary recipients and CC, separately from subject and message templates. Applying one prepares the form and never sends emails.",
          )}
        </p>
        <label className="field">
          {t(locale, "Selección guardada", "Saved selection")}
          <select value={savedId} onChange={(e) => setSavedId(e.target.value)}>
            <option value="">
              {t(locale, "Elige una selección", "Choose a selection")}
            </option>
            {selections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button"
          disabled={!savedId || data.demo}
          onClick={async () => {
            setWorking(true);
            setError("");
            setNotice("");
            try {
              const p = await request({ action: "apply", id: savedId });
              const selection = p.selection as RecipientSelection;
              setDirectory(p.directory);
              setSavedNames(
                Object.fromEntries(
                  selection.targets.map((r) => [
                    r.lender_id,
                    r.lender_name || r.lender_id,
                  ]),
                ),
              );
              onTargets(
                Object.fromEntries(
                  selection.targets.map((r) => [r.lender_id, r.email]),
                ),
              );
              onCopies(
                Object.fromEntries(
                  selection.targets.map((r) => [r.lender_id, r.cc_emails]),
                ),
              );
              onEvaluations({});
              setNotice(
                t(
                  locale,
                  "Selección aplicada. Revisa los destinatarios antes de enviar.",
                  "Selection applied. Review recipients before sending.",
                ),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setWorking(false);
            }
          }}
        >
          {t(
            locale,
            "Aplicar y reemplazar destinatarios",
            "Apply and replace recipients",
          )}
        </button>
        <label className="field">
          {t(locale, "Nombre de la nueva selección", "New selection name")}
          <input
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="button"
          disabled={invalid || !name.trim() || data.demo}
          onClick={async () => {
            setWorking(true);
            setError("");
            setNotice("");
            try {
              const p = await request({
                action: "save",
                id: crypto.randomUUID(),
                name: name.trim(),
                targets: recipientTargets,
              });
              setSelections((old) =>
                [...old, p.selection].sort((a, b) =>
                  a.name.localeCompare(b.name, locale),
                ),
              );
              setSavedId(p.selection.id);
              setName("");
              setNotice(
                t(
                  locale,
                  "Selección de destinatarios guardada en tu cuenta.",
                  "Recipient selection saved to your account.",
                ),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setWorking(false);
            }
          }}
        >
          {t(locale, "Guardar destinatarios", "Save recipients")}
        </button>
      </fieldset>
      <fieldset disabled={disabled} style={groupStyle}>
        <legend>{t(locale, "Agregar lenders", "Add lenders")}</legend>
        <div
          className={"mail-recipient-controls"}
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
            gap: 12,
          }}
        >
          <label className="field">
            {t(
              locale,
              "Buscar empresa o contacto",
              "Search company or contact",
            )}
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="field">
            {t(locale, "Orden", "Order")}
            <select
              value={order}
              onChange={(e) => setOrder(e.target.value as typeof order)}
            >
              <option value="asc">{t(locale, "Nombre A–Z", "Name A–Z")}</option>
              <option value="desc">
                {t(locale, "Nombre Z–A", "Name Z–A")}
              </option>
            </select>
          </label>
        </div>
        <label className="field">
          {t(locale, "Seleccionar un lender", "Select a lender")}
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) add([e.target.value]);
            }}
          >
            <option value="">
              {t(locale, "Elige para agregar", "Choose to add")} ·{" "}
              {filtered.length}
            </option>
            {filtered.map((l) => (
              <option value={l.id} key={l.id} disabled={l.id in targets}>
                {l.name}
                {l.id in targets
                  ? ` · ${t(locale, "seleccionado", "selected")}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
        {!filtered.length && (
          <p>
            {t(
              locale,
              "No hay lenders con contactos habilitados para esta búsqueda.",
              "No lenders with available contacts match this search.",
            )}
          </p>
        )}
        <label className="field">
          {t(locale, "Alcance de las acciones masivas", "Bulk action scope")}
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="filtered">
              {t(locale, "Resultado filtrado", "Filtered results")} (
              {filtered.length})
            </option>
            <option value="all">
              {t(locale, "Catálogo completo", "Entire catalog")} (
              {catalog.length})
            </option>
          </select>
        </label>
        <div className={"mail-recipient-actions"} style={actionStyle}>
          <button
            type="button"
            className="button"
            onClick={() => add(affected.map((l) => l.id))}
          >
            {t(locale, "Seleccionar todos", "Select all")} · {scopeLabel} (
            {affected.length})
          </button>
          <button
            type="button"
            className="button"
            onClick={() =>
              remove(
                scope === "all"
                  ? Object.keys(targets)
                  : affected.map((l) => l.id),
              )
            }
          >
            {t(locale, "Quitar selección", "Clear selection")} · {scopeLabel}
          </button>
        </div>
      </fieldset>
      <p aria-live="polite">
        {t(locale, "Lenders seleccionados", "Selected lenders")}:{" "}
        {recipientTargets.length} / 20
      </p>
      {recipientTargets.map((target) => {
        const contacts = lenderContacts(directory, target.lender_id);
        const targetIssues = issues.filter(
          (i) => i.lender_id === target.lender_id,
        );
        const listId = `${id}-${target.lender_id}`;
        return (
          <fieldset
            className={"mail-recipient-card"}
            style={{ ...groupStyle, overflowWrap: "anywhere" }}
            key={target.lender_id}
            disabled={disabled}
          >
            <legend>{target.lender_name}</legend>
            <button
              type="button"
              className="text-button"
              onClick={() => remove([target.lender_id])}
            >
              {t(locale, "Quitar lender", "Remove lender")}
            </button>
            {!!targetIssues.length && (
              <p className="error-banner" role="alert">
                {t(
                  locale,
                  "Revisa esta empresa o sus contactos: fueron eliminados, están inactivos o ya no pertenecen al lender. Corrige o quita los destinatarios indicados antes de enviar.",
                  "Review this company or its contacts: they were deleted, are inactive or no longer belong to the lender. Correct or remove the listed recipients before sending.",
                )}{" "}
                {targetIssues
                  .map((i) => i.email || target.lender_name)
                  .join(", ")}
              </p>
            )}
            <label className="field">
              {t(
                locale,
                "Para · selecciona o escribe un correo registrado",
                "To · select or type a registered email",
              )}
              <input
                type="email"
                required
                maxLength={254}
                list={listId}
                value={target.email}
                onChange={(e) =>
                  onTargets({
                    ...targets,
                    [target.lender_id]: e.target.value.trim().toLowerCase(),
                  })
                }
              />
              <datalist id={listId}>
                {contacts.map((c) => (
                  <option key={c.email} value={c.email}>
                    {c.name || c.email}
                  </option>
                ))}
              </datalist>
            </label>
            {!!target.email &&
              !contacts.some(
                (c) => c.email.toLowerCase() === target.email.toLowerCase(),
              ) &&
              !targetIssues.some((i) => i.reason === "lender") && (
                <button
                  type="button"
                  className="button"
                  disabled={data.demo}
                  onClick={async () => {
                    setWorking(true);
                    setError("");
                    try {
                      const r = await fetch("/api/mail", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "contact",
                          request_id: crypto.randomUUID(),
                          payload: {
                            opportunity_id: caseId,
                            lender_id: target.lender_id,
                            email: target.email.trim(),
                            name: target.email.trim(),
                          },
                        }),
                      });
                      const p = await r.json();
                      if (!r.ok) throw Error(p.error);
                      setDirectory((old) => ({
                        ...old,
                        contacts: [
                          ...old.contacts.filter(
                            (c) => c.email !== target.email,
                          ),
                          { lender_id: target.lender_id, email: target.email },
                        ],
                      }));
                      setNotice(
                        t(
                          locale,
                          "Contacto registrado en el lender.",
                          "Contact registered with the lender.",
                        ),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setWorking(false);
                    }
                  }}
                >
                  {t(
                    locale,
                    "Registrar este correo en el lender",
                    "Register this email with the lender",
                  )}
                </button>
              )}
            <fieldset>
              <legend>
                {t(
                  locale,
                  "Copias (CC) de este lender",
                  "Copies (CC) for this lender",
                )}
              </legend>
              {[
                ...new Set([
                  ...contacts.map((c) => c.email),
                  ...target.cc_emails,
                ]),
              ]
                .filter((email) => email !== target.email)
                .map((email) => (
                  <label className="document-review-confirm" key={email}>
                    <input
                      type="checkbox"
                      checked={(copies[target.lender_id] || []).includes(email)}
                      onChange={(e) =>
                        onCopies({
                          ...copies,
                          [target.lender_id]: e.target.checked
                            ? [...(copies[target.lender_id] || []), email]
                            : (copies[target.lender_id] || []).filter(
                                (c) => c !== email,
                              ),
                        })
                      }
                    />
                    {contacts.find((c) => c.email === email)?.name || ""}{" "}
                    {email}
                  </label>
                ))}
            </fieldset>
            <label className="field">
              {t(locale, "Evaluación del lender", "Lender evaluation")}
              <select
                value={targetEvaluations[target.lender_id] || ""}
                onChange={(e) =>
                  onEvaluations({
                    ...targetEvaluations,
                    [target.lender_id]: e.target.value,
                  })
                }
              >
                <option value="">
                  {t(
                    locale,
                    "Usar evaluación única o crear borrador",
                    "Use single evaluation or create draft",
                  )}
                </option>
                {evaluations
                  .filter(
                    (s) =>
                      s.lender_id === target.lender_id &&
                      s.process_id === process,
                  )
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.id.slice(0, 8)}
                    </option>
                  ))}
              </select>
            </label>
          </fieldset>
        );
      })}
    </section>
  );
}
