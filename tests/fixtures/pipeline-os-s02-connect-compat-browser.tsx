// Local visual regression fixture. Every account, response and reference is fictitious.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ComposioConnect } from "../../src/components/composio-connect";

function Fixture() {
  const [mount, setMount] = useState(0),
    [counts, setCounts] = useState("");
  return (
    <main>
      <h1>Conexiones — ensayo ficticio local</h1>
      <p>Sin credenciales, Google ni Composio reales.</p>
      <button className="button" onClick={() => setMount((v) => v + 1)}>
        Remontar interfaz
      </button>
      <button
        className="button"
        onClick={async () => {
          const r = await fetch("/__fixture/observations");
          setCounts(JSON.stringify(await r.json()));
        }}
      >
        Ver contadores
      </button>
      <output aria-label="Contadores de ensayo">{counts}</output>
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
