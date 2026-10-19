"use client";
import { useEffect, useState } from "react";
import type { Workspace, Locale } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import {
  DEFAULT_UNDERWRITING_PROMPT,
  DEFAULT_UNDERWRITING_RULES,
} from "@/lib/underwriting";
import type {
  UnderwritingSettings,
  UnderwritingRules,
} from "@/lib/underwriting";
import type { Action } from "./crm";
import { t } from "./ui";
const defaults: UnderwritingSettings = {
  id: 1,
  version: 1,
  prompt: DEFAULT_UNDERWRITING_PROMPT,
  model: "gpt-6.1-sol",
  enabled: true,
  max_output_tokens: 8000,
  daily_run_limit: 10,
  rules: DEFAULT_UNDERWRITING_RULES,
};
export function UnderwritingSettingsPanel({
  data,
  locale,
  act,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
}) {
  const [settings, setSettings] = useState<UnderwritingSettings | null>(
    data.demo ? data.underwriting_settings || defaults : null,
  );
  const [versions, setVersions] = useState<
    NonNullable<Workspace["underwriting_setting_versions"]>
  >(data.underwriting_setting_versions || []);
  const [editable, setEditable] = useState(data.profile.role === "superadmin"),
    [configured, setConfigured] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (data.demo) {
      setSettings(data.underwriting_settings || defaults);
      setVersions(data.underwriting_setting_versions || []);
      setEditable(data.profile.role === "superadmin");
      return;
    }
    const controller = new AbortController();
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [data.demo, data.profile.role]);
  async function load(signal?: AbortSignal) {
    const r = await fetch("/api/underwriting/settings", { signal });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    if (signal?.aborted) return;
    setSettings(body.settings);
    setVersions(body.versions);
    setEditable(body.editable);
    setConfigured(body.configured);
  }
  function update<K extends keyof UnderwritingSettings>(
    key: K,
    value: UnderwritingSettings[K],
  ) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setSaved("");
  }
  function rule(
    group: "sba" | "tier1" | "tier23",
    key: string,
    value: number | boolean,
  ) {
    if (!settings) return;
    update("rules", {
      ...settings.rules,
      [group]: { ...settings.rules[group], [key]: value },
    } as UnderwritingRules);
  }
  async function save() {
    if (!settings) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const payload = {
        ...settings,
        expected_version: settings.version,
        request_key: requestKey,
      };
      if (data.demo) {
        await act("underwriting_settings", payload);
        const next = { ...settings, version: settings.version + 1 };
        setSettings(next);
        setVersions([
          {
            version: next.version,
            model: next.model,
            updated_by: data.profile.id,
            updated_at: new Date().toISOString(),
          },
          ...versions,
        ]);
      } else {
        const r = await fetch("/api/underwriting/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        await load();
      }
      setRequestKey(crypto.randomUUID());
      setSaved(
        t(
          locale,
          "Configuración guardada como una nueva versión.",
          "Settings saved as a new version.",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const numberField = (
    label: string,
    value: number,
    change: (value: number) => void,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label className="field" key={label}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!editable || busy}
        onChange={(e) => change(Number(e.target.value))}
      />
    </label>
  );
  return (
    <section className="panel settings-panel">
      <h2>
        {t(locale, "Análisis y underwriting", "Analysis and underwriting")}
      </h2>
      <p>
        {t(
          locale,
          "Administra el prompt y los criterios internos de revisión. Cada análisis conserva la configuración utilizada y sus archivos de origen.",
          "Manage the prompt and internal screening criteria. Each analysis retains its settings and source files.",
        )}
      </p>
      <p>
        {data.demo
          ? t(
              locale,
              "Demostración: sin cambios en servicios reales.",
              "Demo: no changes to real services.",
            )
          : configured
            ? t(
                locale,
                "OpenAI configurado en la aplicación web. El trabajador necesita la misma configuración.",
                "OpenAI configured for the web app. The worker needs the same configuration.",
              )
            : t(
                locale,
                "Conexión de OpenAI pendiente. Configura la credencial exclusivamente en el servidor y el trabajador.",
                "OpenAI connection pending. Configure credentials only on the server and worker.",
              )}
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            className="button"
            onClick={() => void load().catch((e) => setError(e.message))}
          >
            {t(locale, "Recargar configuración", "Reload settings")}
          </button>
        </div>
      )}
      {saved && <p role="status">{saved}</p>}
      {!settings ? (
        <p role="status">
          {t(locale, "Cargando configuración…", "Loading settings…")}
        </p>
      ) : (
        <>
          <p>Versión {settings.version}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="document-review-confirm">
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={!editable || busy}
                onChange={(e) => update("enabled", e.target.checked)}
              />
              {t(
                locale,
                "Permitir nuevos análisis con IA",
                "Allow new AI analyses",
              )}
            </label>
            <p className="muted">
              {t(
                locale,
                "Desactivar detiene los análisis en cola. Las solicitudes ya enviadas al proveedor pueden terminar.",
                "Disabling stops queued analyses. Requests already sent to the provider may finish.",
              )}
            </p>
            <div className="form-grid">
              <label className="field">
                {t(locale, "Modelo", "Model")}
                <select
                  value={settings.model}
                  disabled={!editable || busy}
                  onChange={(e) => update("model", e.target.value)}
                >
                  {[
                    "gpt-6.1-sol",
                    "gpt-6-sol",
                    "gpt-6-luna",
                    "gpt-6-astra",
                  ].map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
              {numberField(
                t(
                  locale,
                  "Máximo de análisis al día",
                  "Maximum analyses per day",
                ),
                settings.daily_run_limit,
                (v) => update("daily_run_limit", v),
                1,
                500,
              )}
              {numberField(
                t(
                  locale,
                  "Límite de tokens por análisis (razonamiento y salida)",
                  "Token limit per analysis (reasoning and output)",
                ),
                settings.max_output_tokens,
                (v) => update("max_output_tokens", v),
                2000,
                32000,
              )}
            </div>
            <p className="muted">
              {t(
                locale,
                "Este límite incluye el razonamiento y el informe. Si la respuesta queda incompleta por tokens, puedes probar 16.000 o hasta 32.000. Un límite mayor puede aumentar el consumo. Guardar solo afecta a nuevos análisis.",
                "This limit includes reasoning and the report. If the response runs out of tokens, try 16,000 or up to 32,000. A larger limit may increase usage. Saving only affects new analyses.",
              )}
            </p>
            <h3>
              {t(
                locale,
                "Criterios internos para potencial SBA",
                "Internal SBA screening criteria",
              )}
            </h3>
            <div className="form-grid">
              {numberField(
                "Crédito mínimo SBA",
                settings.rules.sba.min_credit_score,
                (v) => rule("sba", "min_credit_score", v),
                300,
                850,
              )}
              {numberField(
                "Años mínimos en operación",
                settings.rules.sba.min_years,
                (v) => rule("sba", "min_years", v),
                0,
                50,
                0.5,
              )}
              {numberField(
                "Máximo de posiciones MCA en 12 meses",
                settings.rules.sba.max_positions_12_months,
                (v) => rule("sba", "max_positions_12_months", v),
                0,
                20,
              )}
            </div>
            <label className="document-review-confirm">
              <input
                type="checkbox"
                checked={settings.rules.sba.requires_profitable_taxes}
                disabled={!editable || busy}
                onChange={(e) =>
                  rule("sba", "requires_profitable_taxes", e.target.checked)
                }
              />
              Exigir rentabilidad comprobada en impuestos
            </label>
            <h3>Tier 1</h3>
            <div className="form-grid">
              {numberField(
                "Crédito mínimo Tier 1",
                settings.rules.tier1.min_credit_score,
                (v) => rule("tier1", "min_credit_score", v),
                300,
                850,
              )}
              {numberField(
                "Meses mínimos en operación",
                settings.rules.tier1.min_months,
                (v) => rule("tier1", "min_months", v),
                0,
                600,
              )}
              {numberField(
                "Máximo de días de saldo negativo (total)",
                settings.rules.tier1.max_negative_days,
                (v) => rule("tier1", "max_negative_days", v),
                0,
                124,
              )}
              {numberField(
                "Máximo de posiciones Tier 1",
                settings.rules.tier1.max_positions,
                (v) => rule("tier1", "max_positions", v),
                0,
                4,
              )}
            </div>
            <h3>Tier 2–3</h3>
            <div className="form-grid">
              {numberField(
                "Crédito mínimo Tier 2–3",
                settings.rules.tier23.min_credit_score,
                (v) => rule("tier23", "min_credit_score", v),
                300,
                850,
              )}
              {numberField(
                "Máximo de posiciones Tier 2–3",
                settings.rules.tier23.max_positions,
                (v) => rule("tier23", "max_positions", v),
                1,
                20,
              )}
              {numberField(
                "Plazo máximo Tier 2–3 (meses)",
                settings.rules.tier23.max_term_months,
                (v) => rule("tier23", "max_term_months", v),
                1,
                60,
              )}
              {numberField(
                "Posiciones para considerar reverse consolidation",
                settings.rules.reverse_min_positions,
                (v) =>
                  update("rules", {
                    ...settings.rules,
                    reverse_min_positions: v,
                  }),
                1,
                20,
              )}
            </div>
            <label className="field">
              {t(locale, "Prompt de underwriting", "Underwriting prompt")}
              <textarea
                value={settings.prompt}
                minLength={100}
                maxLength={30000}
                rows={16}
                required
                disabled={!editable || busy}
                onChange={(e) => update("prompt", e.target.value)}
              />
            </label>
            <p className="muted">
              {t(
                locale,
                "Los campos numéricos anteriores prevalecen sobre cifras antiguas en el prompt. Los resultados siempre requieren revisión humana; los tiers y guidelines deben verificarse con cada lender.",
                "The numeric fields override older thresholds in the prompt. Results always require human review; verify tiers and guidelines with each lender.",
              )}
            </p>
            {editable ? (
              <button className="button primary" disabled={busy}>
                {busy
                  ? t(locale, "Guardando…", "Saving…")
                  : t(locale, "Guardar nueva versión", "Save new version")}
              </button>
            ) : (
              <p>
                {t(
                  locale,
                  "Solo el superadmin puede modificar esta configuración.",
                  "Only the superadmin can change these settings.",
                )}
              </p>
            )}
          </form>
          <h3>{t(locale, "Historial de configuración", "Settings history")}</h3>
          {versions.map((v) => (
            <p key={v.version}>
              v{v.version} · {v.model} · {dateLabel(v.updated_at, locale, true)}{" "}
              ·{" "}
              {data.profiles.find((p) => p.id === v.updated_by)?.name ||
                t(locale, "Configuración inicial", "Initial settings")}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
