import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Workspace } from "../../src/lib/domain";
import { CampaignFlowPanel } from "../../src/components/pipeline-os/campaign-flow-panel";
import "../../src/app/globals.css";
import "../../src/components/pipeline-os/workspace.css";
function Fixture() {
  const [data, setData] = useState<Workspace | null>(null),
    [theme, setTheme] = useState("light");
  const refresh = async () => {
    const r = await fetch("/qa/workspace");
    setData(await r.json());
  };
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <main
      className="pipeline-os"
      data-pos-theme={theme}
      style={{ padding: 24 }}
    >
      <div style={{ maxWidth: 1250, margin: "0 auto" }}>
        <div
          className="pos-info"
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 22,
          }}
        >
          <strong>ENSAYO LOCAL · DATOS FICTICIOS · SIN PROVEEDORES</strong>
          <button
            className="pos-btn"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            Cambiar tema
          </button>
        </div>
        {data ? (
          <CampaignFlowPanel
            data={data}
            locale="es"
            changed={refresh}
            act={async () => {
              throw Error("Fixture: legacy mutations disabled");
            }}
            openConversation={() => {}}
          />
        ) : (
          <p>Cargando…</p>
        )}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
