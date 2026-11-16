// Inert local browser fixture. Not imported by app routes.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CampaignImportFlow } from "../../src/components/pipeline-os/campaign-import-flow";
import { useLeaveConfirmation } from "../../src/components/unsaved-changes";
import type { Workspace } from "../../src/lib/domain";
import "../../src/app/globals.css";
import "../../src/components/pipeline-os/workspace.css";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function Fixture() {
  const { requestLeave, confirmation } = useLeaveConfirmation("es");
  const [generation, setGeneration] = useState(0),
    [closed, setClosed] = useState(false),
    [role, setRole] = useState("superadmin");
  const data = {
    demo: false,
    profile: {
      id: id(1),
      name: "Operador de ejemplo",
      email: "operator@example.test",
      role,
    },
    profiles: [
      {
        id: id(1),
        name: "Operador de ejemplo",
        email: "operator@example.test",
        role: "superadmin",
        active: true,
      },
    ],
    accounts: [
      {
        id: id(2),
        email: "campaigns@example.test",
        status: "connected",
        brand_context: {
          account_id: id(2),
          brand_id: id(3),
          brand_name: "Marca de ejemplo",
          brand_code: "example",
          brand_revision: 1,
          account_revision: 1,
          can_campaign: true,
        },
      },
    ],
    imports: [
      {
        id: id(4),
        name: "Base de ejemplo.xlsx",
        status: "completed",
        total: 6,
        processed: 6,
        imported: 5,
        duplicates: 1,
        skipped: 0,
        errors: 0,
        created_at: "2026-11-16T12:00:00Z",
      },
    ],
    email_templates: [
      {
        id: id(5),
        name: "Presentación de ejemplo",
        subject: "Hola {{company}}",
        body: "Hola {{name}}, conoce nuestra propuesta. {{unsubscribe_url}}",
        version: 1,
        body_format: "plain",
        steps: [],
        asset_ids: [],
        archived_at: null,
      },
    ],
    campaigns: [],
    sender_account_ids: [id(2)],
  } as unknown as Workspace;
  async function control(action: string) {
    await fetch("/qa/" + action, { method: "POST" });
  }
  return (
    <main
      className="pipeline-os"
      data-pos-theme="light"
      style={{ padding: 24 }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div
          className="pos-info"
          style={{
            justifyContent: "space-between",
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          <strong>ENSAYO LOCAL · DATOS FICTICIOS · SIN PROVEEDORES</strong>
          <div className="pos-row" style={{ flexWrap: "wrap" }}>
            <button
              className="pos-btn"
              onClick={() => void control("complete")}
            >
              Simular clasificación completada
            </button>
            <button
              className="pos-btn"
              onClick={() => void control("fail-upload")}
            >
              Simular fallo al registrar
            </button>
            <button
              className="pos-btn"
              onClick={() => {
                void control("reset").then(() => {
                  setClosed(false);
                  setGeneration((x) => x + 1);
                });
              }}
            >
              Reiniciar ejemplo
            </button>
            <label>
              Rol{" "}
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option>superadmin</option>
                <option>seller</option>
              </select>
            </label>
          </div>
        </div>
        {closed ? (
          <p role="status">
            Campaña guardada. El envío requiere la activación manual elegida.
          </p>
        ) : (
          <CampaignImportFlow
            key={generation + role}
            data={data}
            locale="es"
            initialTemplate={null}
            close={() => requestLeave(() => setClosed(true))}
            refresh={async () => {
              const r = await fetch("/qa/refresh");
              if (!r.ok) throw Error("fixture refresh failure");
            }}
            act={async (kind, payload) => {
              const r = await fetch("/qa/action", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, payload }),
              });
              return r.json();
            }}
          />
        )}
      </div>
      {confirmation}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
