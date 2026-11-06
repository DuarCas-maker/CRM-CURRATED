"use client";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/domain";
import {
  brandCollections,
  brandErrorText,
  parseBrandCommand,
  parseBrandPage,
  type BrandCollection,
  type BrandPage,
  type BrandRow,
} from "@/lib/brand-management";
import { ProtectedForm } from "./unsaved-changes";
import { t } from "./ui";

type Catalog = Record<BrandCollection, BrandPage>;
const empty = (): Catalog =>
  Object.fromEntries(
    brandCollections.map((k) => [
      k,
      { items: [], next_cursor: null, is_admin: false },
    ]),
  ) as unknown as Catalog;
const labels = {
  brands: ["Marcas", "Brands"],
  memberships: ["Asignaciones", "Memberships"],
  accounts: ["Cuentas y marca actual", "Accounts and current brand"],
  reviews: ["Asociaciones por revisar", "Account brand reviews"],
  people: ["Equipo", "People"],
} as const;
async function readPage(
  collection: BrandCollection,
  cursor: string | null = null,
) {
  const q = new URLSearchParams({ collection, limit: "25" });
  if (cursor) q.set("cursor", cursor);
  const r = await fetch(`/api/brands?${q}`, { cache: "no-store" });
  const body = await r.json();
  if (!r.ok) throw new Error(body.code || "BRAND_UNAVAILABLE");
  const page = parseBrandPage(collection, body);
  if (!page || (page.next_cursor === cursor && cursor !== null))
    throw new Error("BRAND_UNAVAILABLE");
  return page;
}
function useCatalog(enabled: boolean, admin: boolean) {
  const [catalog, setCatalog] = useState<Catalog>(empty),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0),
    pending = useRef(new Set<BrandCollection>());
  async function refresh() {
    const g = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const keys = admin ? brandCollections : brandCollections.slice(0, 2);
      const entries = await Promise.all(
        keys.map(async (k) => [k, await readPage(k)] as const),
      );
      if (g === generation.current)
        setCatalog({ ...empty(), ...Object.fromEntries(entries) });
    } catch (e) {
      if (g === generation.current) {
        setCatalog(empty());
        setError((e as Error).message);
      }
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }
  async function more(k: BrandCollection) {
    const cursor = catalog[k].next_cursor;
    if (!cursor || pending.current.has(k)) return;
    pending.current.add(k);
    setError("");
    const g = generation.current;
    try {
      const page = await readPage(k, cursor);
      if (g === generation.current)
        setCatalog((c) => ({
          ...c,
          [k]: {
            ...page,
            items: [
              ...c[k].items,
              ...page.items.filter(
                (r) => !c[k].items.some((x) => x.key === r.key),
              ),
            ],
          },
        }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current.delete(k);
    }
  }
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const update = () => void refresh();
    window.addEventListener("crm-brands-updated", update);
    return () => {
      generation.current++;
      window.removeEventListener("crm-brands-updated", update);
    };
    // The scope is fixed by the authenticated workspace, not by a local selector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, admin]);
  return { catalog, loading, error, refresh, more };
}
export function brandRequest(
  previous: { fingerprint: string; key: string } | null,
  kind: string,
  payload: Record<string, unknown>,
  newKey: () => string,
) {
  const fingerprint = JSON.stringify({ kind, payload });
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: newKey() };
}
function Select({
  label,
  name,
  value,
  onChange,
  rows,
  disabled = false,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  rows: { id: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <select
        name={name}
        required
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function BrandSettingsView({
  locale,
  admin,
  loading,
  error,
  collection,
  rows,
  more,
  onCollection,
  onMore,
  children,
}: {
  locale: Locale;
  admin: boolean;
  loading: boolean;
  error: string;
  collection: BrandCollection;
  rows: BrandRow[];
  more: boolean;
  onCollection: (v: BrandCollection) => void;
  onMore: () => void;
  children?: React.ReactNode;
}) {
  return (
    <section className="panel settings-panel" aria-busy={loading}>
      <h2>{t(locale, "Marcas y asignaciones", "Brands and memberships")}</h2>
      <p>
        {t(
          locale,
          "La marca de una cuenta se confirma mediante una revisión. El acceso al historial conserva sus permisos actuales.",
          "An account's brand is confirmed through a review. Existing history permissions are retained.",
        )}
      </p>
      {!admin && (
        <p>
          {t(
            locale,
            "Consulta de tus asignaciones. Solo superadmin puede modificarlas.",
            "Your memberships are read only. Only a superadmin can edit them.",
          )}
        </p>
      )}
      <div
        className="card-actions"
        role="group"
        aria-label={t(locale, "Colecciones de marcas", "Brand collections")}
      >
        {brandCollections
          .filter((k) => admin || k === "brands" || k === "memberships")
          .map((k) => (
            <button
              key={k}
              type="button"
              className="button"
              aria-pressed={k === collection}
              onClick={() => onCollection(k)}
            >
              {labels[k][locale === "es" ? 0 : 1]}
            </button>
          ))}
      </div>
      {loading && <p role="status">{t(locale, "Cargando…", "Loading…")}</p>}
      {error && (
        <p className="error-banner" role="alert">
          {brandErrorText(error, locale)}
        </p>
      )}
      {!loading && !rows.length && (
        <p>
          {t(
            locale,
            "No hay registros en esta colección.",
            "No records in this collection.",
          )}
        </p>
      )}
      <ul style={{ overflowWrap: "anywhere" }}>
        {rows.map((r) => (
          <li key={r.key}>
            <strong>
              {r.name || r.email || r.account_email || r.brand_name || r.code}
            </strong>{" "}
            {r.code || r.brand_code} ·{" "}
            {r.status ||
              (r.active
                ? t(locale, "Activa", "Active")
                : t(locale, "Inactiva", "Inactive"))}
            {r.user_id && <> · {r.user_id}</>}
            {r.email && (
              <>
                {" "}
                ·{" "}
                {r.brand_name ||
                  t(
                    locale,
                    "Marca pendiente de revisión",
                    "Brand awaiting review",
                  )}
              </>
            )}
            {r.impact && (
              <>
                {" "}
                ·{" "}
                {t(
                  locale,
                  "En cola / en envío / inciertos / campañas activas",
                  "Queued / sending / uncertain / active campaigns",
                )}
                : {r.impact.queued}/{r.impact.sending}/{r.impact.uncertain}/
                {r.impact.active_campaigns}
              </>
            )}
          </li>
        ))}
      </ul>
      {more && (
        <button
          type="button"
          className="button"
          disabled={loading}
          onClick={onMore}
        >
          {t(locale, "Cargar más", "Load more")}
        </button>
      )}
      {children}
    </section>
  );
}
export function BrandSettings({
  locale,
  allowed,
  demo = false,
}: {
  locale: Locale;
  allowed: boolean;
  demo?: boolean;
}) {
  const { catalog, loading, error, refresh, more } = useCatalog(!demo, allowed);
  const [collection, setCollection] = useState<BrandCollection>("brands"),
    [operation, setOperation] = useState("create"),
    [brandId, setBrand] = useState(""),
    [userId, setUser] = useState(""),
    [accountId, setAccount] = useState(""),
    [reviewId, setReview] = useState("");
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [notice, setNotice] = useState("");
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const brand = catalog.brands.items.find((r) => r.id === brandId),
    person = catalog.people.items.find((r) => r.id === userId),
    account = catalog.accounts.items.find((r) => r.id === accountId),
    review = catalog.reviews.items.find((r) => r.id === reviewId);
  const member = catalog.memberships.items.find(
    (r) => r.brand_id === brandId && r.user_id === userId,
  );
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || demo || !allowed) return;
    setFailure("");
    setNotice("");
    const form = e.currentTarget,
      p = new FormData(form);
    let kind: string, payload: Record<string, unknown>;
    if (operation === "create") {
      kind = "brand_create";
      payload = {
        code: p.get("code"),
        name: p.get("name"),
        active: p.has("active"),
      };
    } else if (operation === "rename") {
      kind = "brand_update";
      payload = {
        brand_id: brandId,
        name: p.get("name"),
        expected_revision: brand?.revision,
      };
    } else if (operation === "status") {
      kind = "brand_set_status";
      payload = {
        brand_id: brandId,
        active: !brand?.active,
        expected_revision: brand?.revision,
      };
    } else if (operation === "membership") {
      kind = "brand_membership_set";
      payload = {
        brand_id: brandId,
        user_id: userId,
        active: !member?.active,
        expected_revision: member?.revision || 0,
      };
    } else if (operation === "propose") {
      kind = "brand_mapping_propose";
      payload = {
        account_id: accountId,
        proposed_brand_id: brandId || null,
        expected_account_revision: account?.brand_revision,
        evidence_reference: String(p.get("evidence") || "").trim() || null,
        history_approved: p.has("history"),
        history_from: p.get("history_from") || null,
        history_to: p.get("history_to") || null,
        ...(reviewId
          ? { review_id: reviewId, expected_review_revision: review?.revision }
          : {}),
      };
    } else {
      kind =
        operation === "confirm"
          ? "brand_mapping_confirm"
          : "brand_mapping_discard";
      payload = {
        review_id: reviewId,
        expected_review_revision: review?.revision,
        ...(operation === "confirm"
          ? {
              expected_account_revision: review?.expected_account_revision,
              acknowledge_conflict: p.has("acknowledge"),
            }
          : { reason: "admin_discarded" }),
      };
    }
    const parsed = parseBrandCommand(kind, payload);
    if (!parsed) {
      setFailure("BRAND_INVALID_INPUT");
      return;
    }
    payload = parsed.payload;
    retry.current = brandRequest(retry.current, kind, payload, () =>
      crypto.randomUUID(),
    );
    setBusy(true);
    try {
      const r = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          payload,
          idempotency_key: retry.current.key,
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.code || "BRAND_UNAVAILABLE");
      retry.current = null;
      setNotice(
        t(
          locale,
          "Cambio guardado. Revisa el estado actualizado.",
          "Saved. Review the updated state.",
        ),
      );
      window.dispatchEvent(new Event("crm-brands-updated"));
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const options = (k: BrandCollection) =>
    catalog[k].items.map((r) => ({
      id: r.id || r.key,
      label: r.name || r.email || r.account_email || r.key,
    }));
  return (
    <BrandSettingsView
      locale={locale}
      admin={allowed}
      loading={loading}
      error={error}
      collection={collection}
      rows={catalog[collection].items}
      more={!!catalog[collection].next_cursor}
      onCollection={setCollection}
      onMore={() => void more(collection)}
    >
      <button
        type="button"
        className="button"
        disabled={busy || loading || demo}
        onClick={() => void refresh()}
      >
        {t(locale, "Actualizar catálogo", "Refresh catalog")}
      </button>
      {demo && (
        <p>
          {t(
            locale,
            "Demostración sin cambios ni consultas.",
            "Demo: no changes or queries.",
          )}
        </p>
      )}
      {allowed && !demo && (
        <ProtectedForm busy={busy} onSubmit={submit}>
          <fieldset disabled={busy || loading || !!error}>
            <legend>{t(locale, "Administrar", "Manage")}</legend>
            <label>
              {t(locale, "Operación", "Operation")}
              <select
                value={operation}
                onChange={(e) => {
                  setOperation(e.target.value);
                  setFailure("");
                  setNotice("");
                }}
              >
                {[
                  ["create", "Crear marca", "Create brand"],
                  ["rename", "Renombrar marca", "Rename brand"],
                  [
                    "status",
                    "Activar / desactivar marca",
                    "Activate / deactivate brand",
                  ],
                  [
                    "membership",
                    "Asignar / revocar / reactivar usuario",
                    "Assign / revoke / reactivate user",
                  ],
                  [
                    "propose",
                    "Proponer / editar asociación de cuenta",
                    "Propose / edit account mapping",
                  ],
                  [
                    "confirm",
                    "Confirmar asociación revisada",
                    "Confirm reviewed mapping",
                  ],
                  ["discard", "Descartar propuesta", "Discard proposal"],
                ].map(([id, es, en]) => (
                  <option key={id} value={id}>
                    {t(locale, es, en)}
                  </option>
                ))}
              </select>
            </label>
            {["create", "rename"].includes(operation) && (
              <label>
                {t(locale, "Nombre", "Name")}
                <input name="name" required maxLength={120} />
              </label>
            )}
            {operation === "create" && (
              <>
                <label>
                  {t(locale, "Código estable", "Stable code")}
                  <input
                    name="code"
                    required
                    maxLength={32}
                    pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
                  />
                </label>
                <label>
                  <input name="active" type="checkbox" />
                  {t(locale, "Activa", "Active")}
                </label>
              </>
            )}
            {["rename", "status", "membership", "propose"].includes(
              operation,
            ) && (
              <Select
                label={t(locale, "Marca", "Brand")}
                name="brand_id"
                value={brandId}
                onChange={setBrand}
                rows={options("brands")}
              />
            )}
            {operation === "status" && brand && (
              <p>
                {brand.active
                  ? t(
                      locale,
                      "Se desactivará la marca.",
                      "The brand will be deactivated.",
                    )
                  : t(
                      locale,
                      "Se activará la marca sin reanudar campañas.",
                      "The brand will be activated without resuming campaigns.",
                    )}
              </p>
            )}
            {operation === "membership" && (
              <>
                <Select
                  label={t(locale, "Usuario", "User")}
                  name="user_id"
                  value={userId}
                  onChange={setUser}
                  rows={options("people")}
                />
                <p>
                  {member?.active
                    ? t(
                        locale,
                        "Se revocará la asignación.",
                        "The membership will be revoked.",
                      )
                    : t(
                        locale,
                        "Se asignará o reactivará el usuario. No concede permisos de remitente.",
                        "The membership will be assigned or reactivated. This grants no sender permissions.",
                      )}
                  {person &&
                    !person.active &&
                    t(locale, " Usuario inactivo.", " Inactive user.")}
                </p>
              </>
            )}
            {operation === "propose" && (
              <>
                <Select
                  label={t(locale, "Cuenta", "Account")}
                  name="account_id"
                  value={accountId}
                  onChange={(v) => {
                    setAccount(v);
                    setReview("");
                  }}
                  rows={options("accounts")}
                />
                <label>
                  {t(
                    locale,
                    "Propuesta abierta (opcional para editar)",
                    "Open proposal (optional, to edit)",
                  )}
                  <select
                    value={reviewId}
                    onChange={(e) => setReview(e.target.value)}
                  >
                    <option value="">
                      {t(locale, "Nueva propuesta", "New proposal")}
                    </option>
                    {catalog.reviews.items
                      .filter(
                        (r) =>
                          r.account_id === accountId &&
                          ["pending", "conflict"].includes(r.status || ""),
                      )
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.status} · {r.revision}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {t(
                    locale,
                    "Referencia de evidencia (sin documentos ni secretos)",
                    "Evidence reference (no documents or secrets)",
                  )}
                  <input name="evidence" maxLength={120} />
                </label>
                <label>
                  <input type="checkbox" name="history" />
                  {t(
                    locale,
                    "Aprobar intervalo histórico explícito",
                    "Approve an explicit history interval",
                  )}
                </label>
                <label>
                  {t(
                    locale,
                    "Desde (ISO con zona horaria)",
                    "From (ISO with timezone)",
                  )}
                  <input
                    name="history_from"
                    placeholder="2026-01-01T00:00:00-05:00"
                  />
                </label>
                <label>
                  {t(
                    locale,
                    "Hasta (ISO con zona horaria)",
                    "Until (ISO with timezone)",
                  )}
                  <input
                    name="history_to"
                    placeholder="2026-02-01T00:00:00-05:00"
                  />
                </label>
              </>
            )}
            {["confirm", "discard"].includes(operation) && (
              <>
                <Select
                  label={t(locale, "Propuesta", "Proposal")}
                  name="review_id"
                  value={reviewId}
                  onChange={setReview}
                  rows={catalog.reviews.items
                    .filter((r) =>
                      ["pending", "conflict"].includes(r.status || ""),
                    )
                    .map((r) => ({
                      id: r.id!,
                      label: `${r.account_email} · ${r.brand_name || "—"} · ${r.status}`,
                    }))}
                />
                {review && (
                  <p>
                    {review.account_email} → {review.brand_name || "—"} ·{" "}
                    {review.evidence_reference ||
                      t(locale, "Falta evidencia", "Evidence missing")}{" "}
                    · {t(locale, "Histórico aprobado", "History approved")}:{" "}
                    {review.history_approved
                      ? t(locale, "Sí", "Yes")
                      : t(locale, "No", "No")}{" "}
                    {review.history_from} {review.history_to} ·{" "}
                    {t(
                      locale,
                      "En cola / en envío / inciertos / campañas activas",
                      "Queued / sending / uncertain / active campaigns",
                    )}
                    : {review.impact?.queued}/{review.impact?.sending}/
                    {review.impact?.uncertain}/{review.impact?.active_campaigns}
                  </p>
                )}
                {operation === "confirm" && review?.status === "conflict" && (
                  <label>
                    <input type="checkbox" name="acknowledge" required />
                    {t(
                      locale,
                      "Revisé las operaciones pendientes y confirmo esta reasignación.",
                      "I reviewed pending operations and confirm this reassignment.",
                    )}
                  </label>
                )}
              </>
            )}
            <button className="button primary" type="submit">
              {busy
                ? t(locale, "Guardando…", "Saving…")
                : t(locale, "Guardar cambio", "Save change")}
            </button>
          </fieldset>
          {failure && (
            <p className="error-banner" role="alert">
              {brandErrorText(failure, locale)}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
        </ProtectedForm>
      )}
    </BrandSettingsView>
  );
}

export function BrandConnectionFieldsView({
  locale,
  brands,
  accounts,
  loading,
  error,
  disabled = false,
}: {
  locale: Locale;
  brands: BrandRow[];
  accounts: BrandRow[];
  loading: boolean;
  error: string;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState("new"),
    [brandId, setBrand] = useState(""),
    [accountId, setAccount] = useState("");
  const account = accounts.find((r) => r.id === accountId),
    brand = brands.find(
      (r) =>
        r.id ===
          (mode === "reconnect" ? account?.operating_brand_id : brandId) &&
        r.active,
    );
  const ready =
    !disabled &&
    !loading &&
    !error &&
    !!brand &&
    (mode === "new" || !!account?.brand_revision);
  return (
    <>
      <label>
        {t(locale, "Tipo de conexión", "Connection type")}
        <select
          name="mode"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="new">
            {t(locale, "Cuenta nueva", "New account")}
          </option>
          <option value="reconnect">
            {t(
              locale,
              "Reconectar cuenta existente",
              "Reconnect existing account",
            )}
          </option>
        </select>
      </label>
      {mode === "new" ? (
        <Select
          label={t(
            locale,
            "Marca propuesta (requiere revisión)",
            "Proposed brand (requires review)",
          )}
          name="brand_choice"
          value={brandId}
          onChange={setBrand}
          rows={brands
            .filter((r) => r.active)
            .map((r) => ({ id: r.id!, label: r.name! }))}
        />
      ) : (
        <Select
          label={t(
            locale,
            "Cuenta exacta que reconectas",
            "Exact account to reconnect",
          )}
          name="account_choice"
          value={accountId}
          onChange={setAccount}
          rows={accounts
            .filter((r) => r.operating_brand_id && r.brand_revision)
            .map((r) => ({ id: r.id!, label: `${r.email} · ${r.brand_name}` }))}
        />
      )}
      <input type="hidden" name="brand_id" value={brand?.id || ""} />
      <input
        type="hidden"
        name="expected_brand_revision"
        value={brand?.revision || ""}
      />
      {mode === "reconnect" && (
        <>
          <input type="hidden" name="account_id" value={account?.id || ""} />
          <input
            type="hidden"
            name="expected_account_revision"
            value={account?.brand_revision || ""}
          />
        </>
      )}
      {loading && (
        <p role="status">{t(locale, "Cargando marcas…", "Loading brands…")}</p>
      )}
      {error && <p role="alert">{brandErrorText(error, locale)}</p>}
      {!loading && !brands.some((r) => r.active) && (
        <p>
          {t(
            locale,
            "Crea o activa una marca antes de conectar.",
            "Create or activate a brand before connecting.",
          )}
        </p>
      )}
      <button type="submit" className="button" disabled={!ready}>
        {t(locale, "Continuar con Google", "Continue with Google")}
      </button>
    </>
  );
}
export function BrandConnectionFields({
  locale,
  disabled = false,
  demo = false,
}: {
  locale: Locale;
  disabled?: boolean;
  demo?: boolean;
}) {
  const { catalog, loading, error, more, refresh } = useCatalog(!demo, true);
  return (
    <>
      <BrandConnectionFieldsView
        locale={locale}
        brands={catalog.brands.items}
        accounts={catalog.accounts.items}
        loading={loading}
        error={error}
        disabled={disabled || demo}
      />
      {(["brands", "accounts"] as const).map(
        (k) =>
          catalog[k].next_cursor && (
            <button
              type="button"
              key={k}
              className="button"
              onClick={() => void more(k)}
            >
              {t(locale, "Cargar más: ", "Load more: ")}
              {labels[k][locale === "es" ? 0 : 1]}
            </button>
          ),
      )}
      {!!error && (
        <button
          type="button"
          className="button"
          onClick={() => void refresh()}
          disabled={demo}
        >
          {t(locale, "Actualizar", "Refresh")}
        </button>
      )}
    </>
  );
}
