// Offline browser QA only: bundle explicitly; never imported by the application.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ComposioConnect } from "../../src/components/composio-connect";

function Fixture() {
  const [mount, setMount] = useState(0),
    [observations, setObservations] = useState("");
  async function inspect() {
    const r = await fetch("/__fixture/observations");
    setObservations(JSON.stringify(await r.json()));
  }
  async function scenario(value: string) {
    await fetch("/__fixture/scenario", { method: "POST", body: value });
    if (value !== "expired") setMount((v) => v + 1);
  }
  return (
    <main>
      <h1>Connect — ensayo local con datos ficticios</h1>
      <p>
        Este servidor no tiene credenciales ni transporte hacia proveedores.
      </p>
      <button onClick={() => setMount((v) => v + 1)}>Remontar interfaz</button>
      <button onClick={() => void scenario("expired")}>
        Simular vencimiento
      </button>
      <button onClick={() => void scenario("forbidden")}>
        Simular sesión ajena
      </button>
      <button onClick={() => void scenario("conflict")}>
        Simular conflicto
      </button>
      <button onClick={() => void scenario("active")}>
        Restaurar sesión ficticia
      </button>
      <button onClick={() => void inspect()}>Ver contadores</button>
      <output aria-label="Contadores de ensayo">{observations}</output>
      <ComposioConnect
        key={mount}
        locale="es"
        allowed
        demo={false}
        accounts={[]}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
