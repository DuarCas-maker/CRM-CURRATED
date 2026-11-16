import { createRoot } from "react-dom/client";
import { useState } from "react";
import { UserManagement } from "../../src/components/user-management";
import type { ManagedUser, UserCommand } from "../../src/lib/user-management";

const admin = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Alex Administrador",
  email: "alex@example.test",
  role: "superadmin" as const,
  active: true,
};
const users: ManagedUser[] = [
  { ...admin, has_private_text: false, private_version: 0 },
  {
    id: "a0000000-0000-4000-8000-000000000002",
    name: "Mariana Ejemplo de Apellido Extenso",
    email: "mariana.ejemplo@example.test",
    role: "seller",
    active: true,
    has_private_text: true,
    private_version: 1,
  },
  {
    id: "a0000000-0000-4000-8000-000000000003",
    name: "Carlos Ejemplo",
    email: "carlos@example.test",
    role: "closer",
    active: false,
    has_private_text: false,
    private_version: 0,
  },
];
const values = new Map([[users[1].id, "Texto ficticio para QA"]]);
let fail = false,
  empty = false,
  delay = false;
let postCount = 0,
  revealCount = 0;
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.origin !== location.origin || url.pathname !== "/api/users")
    throw new Error("FIXTURE_EXTERNAL_CALL_BLOCKED");
  if (delay) await new Promise((resolve) => setTimeout(resolve, 2000));
  if (fail)
    return Response.json(
      { error: "Fallo ficticio de conexión. Puedes reintentar." },
      { status: 503 },
    );
  if (init?.method !== "POST") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const found = empty
      ? []
      : users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q));
    return Response.json({ items: found, total: found.length, page: 0 });
  }
  postCount++;
  document.getElementById("fixture-audit")!.textContent =
    `POST ficticios: ${postCount}; lecturas privadas: ${revealCount}; llamadas reales: 0`;
  const command = JSON.parse(String(init.body)) as UserCommand;
  if (command.action === "create") {
    users.push({
      id: command.request_id,
      name: command.name,
      email: command.email,
      role: command.role,
      active: true,
      has_private_text: false,
      private_version: 0,
    });
    return Response.json({ ok: true, id: command.request_id });
  }
  const user = users.find((u) => u.id === command.user_id)!;
  if (command.action === "reveal") {
    revealCount++;
    document.getElementById("fixture-audit")!.textContent =
      `POST ficticios: ${postCount}; lecturas privadas: ${revealCount}; llamadas reales: 0`;
    return Response.json({
      text: values.get(user.id) || "",
      version: user.private_version,
    });
  }
  if (command.action === "access") {
    user.active = command.active;
    user.role = command.role;
  }
  if (command.action === "private_text") {
    values.set(user.id, command.text);
    user.has_private_text = command.text !== "";
    user.private_version++;
    return Response.json({ ok: true, version: user.private_version });
  }
  return Response.json({ ok: true });
};
function Fixture() {
  const [revision, setRevision] = useState(0),
    [locale, setLocale] = useState<"es" | "en">("es");
  return (
    <>
      <div id="fixture-tools">
        <button
          className="button"
          onClick={() => {
            fail = !fail;
            setRevision((v) => v + 1);
          }}
        >
          Alternar error
        </button>
        <button
          className="button"
          onClick={() => {
            empty = !empty;
            setRevision((v) => v + 1);
          }}
        >
          Alternar vacío
        </button>
        <button
          className="button"
          onClick={() => {
            delay = !delay;
            setRevision((v) => v + 1);
          }}
        >
          Alternar carga lenta
        </button>
        <button
          className="button"
          onClick={() => setLocale((v) => (v === "es" ? "en" : "es"))}
        >
          ES / EN
        </button>
      </div>
      <UserManagement key={revision} profile={admin} locale={locale} />
      <p id="fixture-audit" role="status">
        POST ficticios: 0; lecturas privadas: 0; llamadas reales: 0
      </p>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
