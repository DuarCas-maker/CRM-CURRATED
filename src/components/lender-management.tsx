"use client";
import { useEffect, useState } from "react";
import type { Workspace, Locale, Lender } from "@/lib/domain";
import {
  emptyLenderGuidelines,
  lenderGuidelinesSchema,
  lenderImportRowSchema,
  planLenderImport,
  type LenderGuidelines,
  type LenderImportRow,
} from "@/lib/lender-management";
import { suggestedLenderTier } from "@/lib/lender-catalogue";
import type { Action } from "./crm";
import { Modal, t } from "./ui";
export function LenderGuidelinesEditor({
  lender,
  data,
  locale,
  act,
  refresh,
  close,
}: {
  lender: Lender;
  data: Workspace;
  locale: Locale;
  act: Action;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const [g, setG] = useState<LenderGuidelines>(
    lender.guidelines || {
      ...emptyLenderGuidelines,
      tier: suggestedLenderTier(lender.name) as LenderGuidelines["tier"],
    },
  );
  const [history, setHistory] = useState<
    { version: number; created_at: string; guidelines: LenderGuidelines }[]
  >([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const canEdit = ["superadmin", "closer_admin"].includes(data.profile.role);
  useEffect(() => {
    if (data.demo) return;
    const controller = new AbortController();
    void fetch(`/api/lenders/guidelines?lender=${lender.id}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        setHistory(body);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [lender.id, data.demo]);
  function change(p: Partial<LenderGuidelines>) {
    setG((v) => ({ ...v, ...p }));
    setRequestKey(crypto.randomUUID());
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const guidelines = lenderGuidelinesSchema.parse(g);
      if (data.demo)
        await act("lender_guidelines", { lender_id: lender.id, g: guidelines });
      else {
        const r = await fetch("/api/lenders/guidelines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lender: lender.id,
            g: guidelines,
            expected_version: lender.guideline_version || 0,
            request_key: requestKey,
          }),
        });
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        await refresh();
      }
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const numeric = (
    label: string,
    key: "min_credit" | "min_months_in_business" | "max_positions",
    min: number,
    max: number,
  ) => (
    <label className="field">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        placeholder={t(locale, "Sin confirmar", "Unknown")}
        value={g[key] ?? ""}
        onChange={(e) =>
          change({
            [key]: e.target.value === "" ? null : Number(e.target.value),
          })
        }
      />
    </label>
  );
  const flag = (
    label: string,
    key: "accepts_defaults" | "accepts_non_us_citizens" | "reverse",
  ) => (
    <label className="field">
      {label}
      <select
        value={g[key] === null ? "unknown" : String(g[key])}
        onChange={(e) =>
          change({
            [key]:
              e.target.value === "unknown" ? null : e.target.value === "true",
          })
        }
      >
        <option value="unknown">{t(locale, "Sin confirmar", "Unknown")}</option>
        <option value="true">{t(locale, "Sí", "Yes")}</option>
        <option value="false">No</option>
      </select>
    </label>
  );
  return (
    <Modal
      busy={busy}
      trackChanges
      locale={locale}
      title={`${lender.name} · Guidelines v${lender.guideline_version || 0}`}
      close={close}
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="muted">
        {t(
          locale,
          "Los tiers sugeridos provienen de la referencia interna. Confirma los criterios con el lender e indica su fuente y fecha.",
          "Suggested tiers come from the internal reference. Confirm criteria with the lender and record their source and date.",
        )}
      </p>
      <fieldset disabled={!canEdit || busy} style={{ border: 0, padding: 0 }}>
        <div className="form-grid">
          <label className="field">
            Tier
            <select
              value={g.tier}
              onChange={(e) =>
                change({ tier: e.target.value as LenderGuidelines["tier"] })
              }
            >
              {["unknown", "1", "2", "3", "4", "5", "6", "reverse"].map(
                (tier) => (
                  <option key={tier} value={tier}>
                    {tier === "unknown"
                      ? t(locale, "Sin confirmar", "Unknown")
                      : tier}
                  </option>
                ),
              )}
            </select>
          </label>
          {numeric(
            t(locale, "Crédito mínimo", "Minimum credit"),
            "min_credit",
            300,
            850,
          )}
          {numeric(
            t(
              locale,
              "Meses mínimos de actividad",
              "Minimum months in business",
            ),
            "min_months_in_business",
            0,
            1200,
          )}
          {numeric(
            t(
              locale,
              "Máximo de posiciones activas",
              "Maximum active positions",
            ),
            "max_positions",
            0,
            100,
          )}
          {flag(
            t(locale, "Acepta defaults", "Accepts defaults"),
            "accepts_defaults",
          )}
          {flag(
            t(
              locale,
              "Acepta no ciudadanos de EE. UU.",
              "Accepts non-US citizens",
            ),
            "accepts_non_us_citizens",
          )}
          {flag("Reverse consolidation", "reverse")}
        </div>
        <label className="field">
          {t(
            locale,
            "Industrias aceptadas (separadas por coma)",
            "Accepted industries (comma separated)",
          )}
          <input
            defaultValue={g.industries.join(", ")}
            onBlur={(e) =>
              change({
                industries: e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label className="field">
          {t(locale, "Industrias excluidas", "Excluded industries")}
          <input
            defaultValue={g.excluded_industries.join(", ")}
            onBlur={(e) =>
              change({
                excluded_industries: e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label className="field">
          {t(
            locale,
            "Guidelines y condiciones adicionales",
            "Guidelines and additional conditions",
          )}
          <textarea
            rows={7}
            value={g.notes}
            onChange={(e) => change({ notes: e.target.value })}
          />
        </label>
        <label className="field">
          {t(
            locale,
            "Fuente: enlace, documento o contacto",
            "Source: link, document or contact",
          )}
          <input
            value={g.source}
            onChange={(e) => change({ source: e.target.value })}
          />
        </label>
        <label className="field">
          {t(locale, "Fecha de confirmación", "Confirmation date")}
          <input
            type="date"
            value={g.as_of || ""}
            onChange={(e) => change({ as_of: e.target.value || null })}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={g.verified}
            onChange={(e) => change({ verified: e.target.checked })}
          />
          {t(
            locale,
            "Criterios confirmados con el lender",
            "Criteria confirmed with lender",
          )}
        </label>
      </fieldset>
      {history.length > 0 && (
        <details>
          <summary>
            {t(locale, "Historial de versiones", "Version history")} (
            {history.length})
          </summary>
          {history.map((v) => (
            <div className="analysis-card" key={v.version}>
              <strong>
                v{v.version} · {v.created_at.slice(0, 10)}
              </strong>
              <p>
                {v.guidelines.source} · Tier {v.guidelines.tier}
              </p>
              <p>{v.guidelines.notes}</p>
            </div>
          ))}
        </details>
      )}
      {canEdit && (
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {t(locale, "Guardar nueva versión", "Save new version")}
        </button>
      )}
    </Modal>
  );
}
const fields: [keyof LenderImportRow, string, string[]][] = [
  ["company", "Empresa / Company", ["company", "empresa", "lender", "name"]],
  ["email", "Correo / Email", ["email", "correo", "e-mail"]],
  [
    "contact",
    "Nombre del contacto / Contact",
    ["contact", "contacto", "nombre", "contact name"],
  ],
  ["channel", "Canal / Channel", ["channel", "canal"]],
  ["portal_url", "Portal URL", ["portal_url", "portal", "url"]],
  ["products", "Productos / Products", ["products", "productos"]],
  ["notes", "Notas / Notes", ["notes", "notas", "guidelines"]],
];
export function LenderImportWizard({
  data,
  locale,
  act,
  refresh,
  close,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const [raw, setRaw] = useState<Record<string, string>[]>([]),
    [headers, setHeaders] = useState<string[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<ReturnType<typeof planLenderImport> | null>(
      null,
    ),
    [rows, setRows] = useState<LenderImportRow[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState<Record<string, number> | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  async function read(file: File) {
    setBusy(true);
    setError("");
    setPlan(null);
    setDone(null);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Máximo 5 MB.");
      let result: { headers: string[]; rows: Record<string, string>[] };
      if (data.demo) {
        if (!file.name.toLowerCase().endsWith(".csv"))
          throw new Error(
            "En demo utiliza CSV; XLSX está disponible en el CRM conectado.",
          );
        const Papa = (await import("papaparse")).default;
        const parsed = Papa.parse<Record<string, string>>(await file.text(), {
          header: true,
          skipEmptyLines: "greedy",
        });
        if (parsed.errors.length) throw new Error("CSV inválido");
        result = { headers: parsed.meta.fields || [], rows: parsed.data };
      } else {
        const f = new FormData();
        f.set("file", file);
        const r = await fetch("/api/lenders/import", {
          method: "POST",
          body: f,
        });
        result = await r.json();
        if (!r.ok)
          throw new Error((result as unknown as { error: string }).error);
      }
      if (result.rows.length > 1000) throw new Error("Máximo 1000 filas.");
      setRaw(result.rows);
      setHeaders(result.headers);
      setMapping(
        Object.fromEntries(
          fields.map(([key, , aliases]) => [
            key,
            result.headers.find((h) =>
              aliases.includes(h.trim().toLowerCase()),
            ) || "",
          ]),
        ),
      );
      setKey(crypto.randomUUID());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    setBusy(true);
    setError("");
    try {
      const normalized = raw.map((row, i) => {
        const input = Object.fromEntries(
          fields.map(([key]) => [
            key,
            row[mapping[key]]?.trim() || (key === "channel" ? "email" : ""),
          ]),
        );
        input.channel = input.channel.toLowerCase();
        const parsed = lenderImportRowSchema.safeParse(input);
        if (!parsed.success)
          throw new Error(`Fila ${i + 1}: ${parsed.error.issues[0]?.message}`);
        return parsed.data;
      });
      setRows(normalized);
      if (data.demo)
        setPlan(
          planLenderImport(
            normalized,
            data.lenders,
            data.lender_contacts || [],
          ),
        );
      else {
        const r = await fetch("/api/lenders/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "preview", rows: normalized }),
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        setPlan(result);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function execute() {
    setBusy(true);
    setError("");
    try {
      if (data.demo) {
        await act("import_lenders", { rows });
        setDone({
          new_companies: plan!.new_companies,
          new_contacts: plan!.new_contacts,
        });
      } else {
        const r = await fetch("/api/lenders/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows, request_key: key }),
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        setDone(result);
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      busy={busy}
      dirty={!done && raw.length > 0}
      locale={locale}
      title={t(
        locale,
        "Importar empresas y contactos",
        "Import companies and contacts",
      )}
      close={close}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p>
        {t(
          locale,
          "CSV o XLSX, primera hoja, hasta 1000 filas / 5 MB. Cada fila contiene una empresa y un contacto. Se agrupa por nombre exacto de empresa; los datos existentes se conservan.",
          "CSV or XLSX, first sheet, up to 1000 rows / 5 MB. One company and contact per row. Exact company names are grouped; existing data is preserved.",
        )}
      </p>
      <label className="field">
        {t(locale, "Archivo de lenders", "Lender file")}
        <input
          disabled={busy}
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void read(file);
            e.target.value = "";
          }}
        />
      </label>
      {headers.length > 0 && !done && (
        <>
          <div className="form-grid">
            {fields.map(([key, label]) => (
              <label className="field" key={key}>
                {label}
                <select
                  value={mapping[key] || ""}
                  onChange={(e) => {
                    setMapping((m) => ({ ...m, [key]: e.target.value }));
                    setPlan(null);
                    setKey(crypto.randomUUID());
                  }}
                >
                  <option value="">—</option>
                  {headers.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            className="button"
            disabled={busy}
            onClick={() => void preview()}
          >
            {t(locale, "Revisar importación", "Preview import")}
          </button>
        </>
      )}
      {plan && !done && (
        <section className="analysis-card">
          <h3>{t(locale, "Resultado previsto", "Expected result")}</h3>
          <p>
            {plan.companies} {t(locale, "empresas", "companies")} ·{" "}
            {plan.new_companies} {t(locale, "nuevas", "new")} ·{" "}
            {plan.existing_companies} {t(locale, "existentes", "existing")} ·{" "}
            {plan.new_contacts} {t(locale, "correos nuevos", "new emails")} ·{" "}
            {plan.duplicate_rows}{" "}
            {t(locale, "filas duplicadas", "duplicate rows")}
          </p>
          {plan.errors.map((e, i) => (
            <p role="alert" key={i}>
              Fila {e.row}: {e.message}
            </p>
          ))}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Contacto</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td>{r.company}</td>
                    <td>{r.contact}</td>
                    <td>{r.email || r.portal_url}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="button primary"
            disabled={busy || plan.errors.length > 0}
            onClick={() => void execute()}
          >
            {t(locale, "Importar lista revisada", "Import reviewed list")}
          </button>
        </section>
      )}
      {done && (
        <p role="status">
          {t(locale, "Importación completada", "Import complete")}:{" "}
          {done.new_companies} {t(locale, "empresas nuevas", "new companies")} ·{" "}
          {done.new_contacts} {t(locale, "correos nuevos", "new emails")}.
        </p>
      )}
    </Modal>
  );
}
