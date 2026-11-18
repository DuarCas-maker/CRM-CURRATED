// Browser-only fake ports. No credentials, tokens or provider requests.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ConnectionsWorkspace } from "../../src/components/connections-workspace";
import { demoWorkspace } from "../../src/lib/demo";
import { demoConnections } from "../../src/lib/connections";
const id = "11111111-1111-4111-8111-111111111111",
  advisor = "22222222-2222-4222-8222-222222222222";
const data = demoWorkspace();
data.demo = false;
data.profile.active = true;
data.profile.role = "superadmin";
const snapshot = demoConnections(data.accounts);
snapshot.accounts = snapshot.accounts.slice(0, 1).map((a) => ({
  ...a,
  id,
  email: "asesor@example.test",
  brand: "Curated Financial",
  organization: "fixture",
  permissions: [{ name: "Asesor de prueba", active: true, can_send: true }],
  synced_at: "2026-11-17T18:30:00Z",
}));
let current = {
  id,
  email: "asesor@example.test",
  provider: "gmail_oauth",
  state: "authorizing",
  account_id: id,
  advisor_id: advisor,
  error: null,
  sync_status: "current",
  last_synced_at: "2026-11-17T18:30:00Z",
};
let calls = 0,
  posts = 0;
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.origin !== location.origin) throw Error("QA_EXTERNAL_BLOCKED");
  calls++;
  if (url.pathname === "/api/mail/connections") {
    if (init?.method === "POST") {
      posts++;
      const p = JSON.parse(String(init.body));
      current = {
        ...current,
        email: p.email,
        provider: p.provider,
        state: "ready",
      };
      return Response.json(current);
    }
    return Response.json({
      enabled: true,
      included_available: false,
      advisors: [
        { id: advisor, name: "Asesor de prueba", email: "asesor@example.test" },
      ],
      connections: [current],
    });
  }
  if (url.pathname.endsWith("/continue")) {
    posts++;
    current = { ...current, state: "ready" };
    return Response.json(current);
  }
  if (url.pathname.endsWith("/disconnect")) {
    posts++;
    current = { ...current, state: "disconnected" };
    return Response.json(current);
  }
  if (url.pathname === "/api/connections") return Response.json(snapshot);
  if (url.pathname.startsWith("/api/mail/connections/"))
    return Response.json(current);
  return Response.json({ error: "Ruta fuera del ensayo" }, { status: 503 });
};
function Fixture() {
  const [counter, setCounter] = useState("");
  return (
    <main>
      <p className="qa-label">
        Ensayo local · cuentas ficticias · sin llamadas reales
      </p>
      <ConnectionsWorkspace
        data={data}
        locale="es"
        busy={false}
        act={async () => undefined}
        initialSnapshot={snapshot}
      />
      <button
        className="button"
        onClick={() =>
          setCounter(JSON.stringify({ calls, posts, externalRequests: 0 }))
        }
      >
        Ver contadores del ensayo
      </button>
      <output aria-label="Contadores del ensayo">{counter}</output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
