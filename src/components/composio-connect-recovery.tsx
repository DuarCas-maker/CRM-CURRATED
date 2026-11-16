"use client";
import { useRef, useState } from "react";
import type { Locale } from "@/lib/domain";
import {
  connectRecoveryItemsHttp,
  connectViewHttp,
} from "@/lib/composio-connect-http";
import { t } from "./ui";

function RecoveredCandidate({
  source,
  locale,
}: {
  source: string;
  locale: Locale;
}) {
  const [review, setReview] = useState<{
      state: string;
      expected: Record<string, unknown>;
      brand: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef("");
  async function run(register: boolean) {
    setBusy(true);
    setError("");
    try {
      const endpoint = "/api/mail/composio/connect/recovery/candidate";
      if (register && !key.current) key.current = crypto.randomUUID();
      const response = await fetch(
        register
          ? endpoint
          : endpoint + "?source_id=" + encodeURIComponent(source),
        register
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                source_id: source,
                expected: review?.expected,
                idempotency_key: key.current,
              }),
            }
          : { cache: "no-store" },
      );
      if (!response.ok) throw Error();
      const result = await response.json();
      if (
        !["ready", "candidate"].includes(result.state) ||
        result.transport_active !== false ||
        !result.expected ||
        typeof result.brand !== "string"
      )
        throw Error();
      setReview(result);
    } catch {
      setError(
        t(
          locale,
          "No se pudo completar el registro. Revisa MFA, marca y el estado actual; no se activaron envíos.",
          "Registration could not be completed. Check MFA, brand and current state; sending was not activated.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div aria-busy={busy}>
      {!review && (
        <button
          className="button"
          disabled={busy}
          onClick={() => void run(false)}
        >
          {t(
            locale,
            "Revisar candidato recuperado",
            "Review recovered candidate",
          )}
        </button>
      )}
      {review?.state === "ready" && (
        <>
          <p>
            {t(locale, "Marca confirmada", "Confirmed brand")}: {review.brand}
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void run(true)}
          >
            {t(
              locale,
              "Registrar candidato sin activar envíos",
              "Register candidate without activating sending",
            )}
          </button>
        </>
      )}
      {review?.state === "candidate" && (
        <p role="status">
          {t(
            locale,
            "Candidato registrado; pendiente de verificar permisos. Envíos y transporte sin activar.",
            "Candidate registered; permission verification pending. Sending and transport remain inactive.",
          )}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function ComposioConnectRecovery({
  locale,
  onRecovered,
}: {
  locale: Locale;
  onRecovered(id: string): void;
}) {
  const [items, setItems] = useState<
    ReturnType<typeof connectRecoveryItemsHttp.parse>["items"] | null
  >(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const keys = useRef(new Map<string, string>());
  async function load() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/mail/composio/connect/recovery", {
        cache: "no-store",
      });
      if (!r.ok) throw Error();
      setItems(connectRecoveryItemsHttp.parse(await r.json()).items);
    } catch {
      setError(
        t(
          locale,
          "No se pudieron consultar las conexiones. Revisa tu sesión de superadmin y MFA.",
          "Could not read connections. Check your superadmin session and MFA.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function recover(row: NonNullable<typeof items>[number]) {
    setBusy(true);
    setError("");
    let key = keys.current.get(row.source_id);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(row.source_id, key);
    }
    try {
      const r = await fetch("/api/mail/composio/connect/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          source_id: row.source_id,
          expected_revision: row.source_revision,
          idempotency_key: key,
        }),
      });
      if (!r.ok) throw Error();
      const view = connectViewHttp.parse(await r.json());
      if (!view.status) throw Error();
      onRecovered(view.status.id);
      setItems(
        (previous) =>
          previous?.filter((item) => item.source_id !== row.source_id) ?? null,
      );
    } catch {
      // An uncertain POST is never repeated by this component. A completed durable result can be reopened from the list.
      setItems(null);
      setError(
        t(
          locale,
          "La conciliación no se confirmó. Consulta de nuevo el estado; no repitas la autorización en Google ni crees otro enlace.",
          "Reconciliation was not confirmed. Check the state again; do not repeat Google authorization or create another link.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel settings-panel"
      aria-label={t(
        locale,
        "Recuperar conexión existente",
        "Recover existing connection",
      )}
      aria-busy={busy}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h2>
        {t(
          locale,
          "Recuperar conexión existente",
          "Recover existing connection",
        )}
      </h2>
      <p>
        {t(
          locale,
          "Si Google ya fue autorizado y el intento venció, consulta la conexión original. Recuperar verifica el correo sin volver a Google; la marca y el transporte conservan sus revisiones separadas.",
          "If Google was already authorized and the attempt expired, inspect the original connection. Recovery verifies the email without returning to Google; brand and transport retain their separate reviews.",
        )}
      </p>
      <button className="button" disabled={busy} onClick={() => void load()}>
        {t(
          locale,
          "Consultar conexiones recuperables",
          "Find recoverable connections",
        )}
      </button>
      {error && <p role="alert">{error}</p>}
      {items?.length === 0 && (
        <p role="status">
          {t(
            locale,
            "No hay intentos propios recuperables en este momento.",
            "There are no recoverable attempts of yours right now.",
          )}
        </p>
      )}
      {items?.map((row) => (
        <div key={row.source_id} className="panel" style={{ marginTop: 12 }}>
          <p>{row.email}</p>
          <p>
            {t(locale, "Intento original", "Original attempt")}:{" "}
            {new Date(row.created_at).toLocaleString(
              locale === "es" ? "es-CO" : "en-US",
            )}
          </p>
          {row.state === "completed" && (
            <RecoveredCandidate source={row.source_id} locale={locale} />
          )}
          {row.state === "available" ? (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void recover(row)}
            >
              {t(
                locale,
                "Conciliar sin volver a Google",
                "Reconcile without returning to Google",
              )}
            </button>
          ) : row.state === "completed" && row.child_id ? (
            <button
              className="button"
              disabled={busy}
              onClick={() => onRecovered(row.child_id!)}
            >
              {t(
                locale,
                "Abrir conexión recuperada",
                "Open recovered connection",
              )}
            </button>
          ) : (
            <p role="status">
              {t(
                locale,
                "Requiere revisión de la conciliación; no se reintentará el proveedor.",
                "Reconciliation needs review; the provider will not be retried.",
              )}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
