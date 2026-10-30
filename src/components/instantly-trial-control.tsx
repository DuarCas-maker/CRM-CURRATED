"use client";
import { useState } from "react";
type Approval = {
  intentId: string;
  manifest: {
    origin: string;
    receiverManifest: { nonce: string; startsAt: number; endsAt: number };
    draft: boolean;
    executionReady: boolean;
  };
};
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function InstantlyTrialControl({ allowed }: { allowed: boolean }) {
  const [approval, setApproval] = useState<Approval | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [attempted, setAttempted] = useState(false),
    [ticket, setTicket] = useState<Record<string, unknown> | null>(null);
  if (!allowed) return null;
  async function fileChanged(file: File | undefined) {
    setError("");
    setApproval(null);
    if (!file) return;
    try {
      if (file.size > 16384) throw Error();
      const a = JSON.parse(await file.text());
      if (
        !/^[a-f0-9-]{36}$/i.test(a.intentId) ||
        a.manifest?.draft !== false ||
        a.manifest?.executionReady !== true ||
        !/^[a-f0-9]{24}$/.test(a.manifest?.receiverManifest?.nonce) ||
        a.manifest.origin !== window.location.origin
      )
        throw Error();
      setApproval(a);
    } catch {
      setError(
        "Selecciona la autorización final preparada para este CRM. El borrador todavía no se puede autorizar.",
      );
    }
  }
  async function authorize() {
    if (!approval || attempted) return;
    setAttempted(true);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/integrations/instantly/trials/" +
          approval.manifest.receiverManifest.nonce +
          "/lease",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(approval),
          redirect: "error",
        },
      );
      if (response.status !== 201) throw Error();
      const data = await response.json();
      if (
        data.credential?.variable !== "INSTANTLY_S00_CONTROL_TOKEN" ||
        !/^[a-f0-9]{64}$/.test(data.credential?.value) ||
        data.ticket?.intentId !== approval.intentId
      )
        throw Error();
      download(
        "instantly-control-ticket.env",
        "INSTANTLY_S00_CONTROL_TOKEN=" + data.credential.value + "\n",
        "text/plain",
      );
      setTicket(data.ticket);
      delete data.credential;
    } catch {
      setError(
        "No se confirmó la entrega del permiso. No repitas la autorización: revisa el ensayo con el operador antes de continuar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel settings-panel"
      aria-label="Ensayo técnico de Instantly"
    >
      <h2>Ensayo técnico de Instantly</h2>
      <p>
        Autoriza un único ensayo con tu sesión y MFA. Este control no activa
        campañas ni envía correos.
      </p>
      <label className="field">
        <span>Archivo de autorización del ensayo</span>
        <input
          type="file"
          accept="application/json,.json"
          disabled={attempted}
          onChange={(e) => void fileChanged(e.target.files?.[0])}
        />
      </label>
      {approval && (
        <dl>
          <dt>Destino</dt>
          <dd>{approval.manifest.origin}</dd>
          <dt>Ventana de recepción</dt>
          <dd>
            {new Date(
              approval.manifest.receiverManifest.startsAt,
            ).toLocaleString()}{" "}
            –{" "}
            {new Date(
              approval.manifest.receiverManifest.endsAt,
            ).toLocaleTimeString()}
          </dd>
          <dt>Límite del ensayo</dt>
          <dd>19 peticiones a Instantly y 25 al control del CRM.</dd>
        </dl>
      )}
      <button
        className="button"
        disabled={!approval || busy || attempted}
        onClick={() => void authorize()}
      >
        {busy ? "Autorizando…" : "Autorizar este ensayo"}
      </button>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {ticket && (
        <div role="status">
          <p>
            Permiso emitido. Guarda la credencial descargada en la carpeta
            privada del ensayo; no la compartas por chat. El permiso caduca
            automáticamente.
          </p>
          <button
            className="button"
            onClick={() =>
              download(
                "instantly-control-metadata.json",
                JSON.stringify(ticket, null, 2),
                "application/json",
              )
            }
          >
            Guardar metadata del permiso
          </button>
        </div>
      )}
    </section>
  );
}
