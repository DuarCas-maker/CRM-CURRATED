import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MailConnectionPanel } from "@/components/mail-connection-panel";
import "@/app/globals.css";

const advisor = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
let connection: any = null;
const keys: string[] = [];
let continues = 0,
  preserved = true;
let report = () => {};
// Isolated UI fixture only. Unknown requests fail; no provider/CRM is contacted.
window.fetch = async (input, init) => {
  const path = String(input);
  const method = init?.method ?? "GET";
  await new Promise((r) => setTimeout(r, 40));
  if (path === "/api/mail/connections" && method === "GET")
    return Response.json({
      enabled: true,
      composio_enabled: false,
      included_available: false,
      direct_account_ids: [],
      advisors: [
        { id: advisor, email: "owner@example.test", name: "Asesor de prueba" },
      ],
      connections: connection ? [connection] : [],
    });
  if (path === "/api/mail/connections" && method === "POST") {
    const body = JSON.parse(String(init?.body));
    keys.push(body.idempotency_key);
    preserved =
      preserved &&
      body.email === "new@example.test" &&
      body.advisor_id === advisor;
    report();
    if (keys.length === 1)
      return Response.json(
        {
          code: "SIMPLE_UNAVAILABLE",
          error:
            "No se pudo preparar la conexión. Inténtalo de nuevo; conservamos el correo y el asesor seleccionados.",
        },
        { status: 503 },
      );
    connection = {
      id,
      email: body.email,
      advisor_id: advisor,
      provider: "gmail_oauth",
      state: "preparing",
      account_id: id,
      error: null,
    };
    return Response.json(connection);
  }
  if (path === `/api/mail/connections/${id}/continue` && method === "POST") {
    continues++;
    report();
    if (continues === 1)
      return Response.json(
        {
          error:
            "La preparación no pudo terminar. Retoma la conexión desde este paso.",
        },
        { status: 503 },
      );
    connection = { ...connection, state: "ready" };
    return Response.json(connection);
  }
  throw Error("OFFLINE_FIXTURE_UNEXPECTED_REQUEST");
};
function App() {
  const [stats, setStats] = useState("");
  report = () =>
    setStats(
      JSON.stringify({
        create_requests: keys.length,
        continue_requests: continues,
        same_idempotency_key:
          keys.length > 1 && keys.every((k) => k === keys[0]),
        fields_preserved: preserved,
        provider_calls: 0,
      }),
    );
  return (
    <main style={{ padding: 20 }}>
      <h1>Conexiones · ensayo local</h1>
      <MailConnectionPanel provider="gmail_oauth" accounts={[]} />
      <details>
        <summary>Comprobaciones offline</summary>
        <output aria-label="Comprobaciones offline">{stats}</output>
      </details>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
