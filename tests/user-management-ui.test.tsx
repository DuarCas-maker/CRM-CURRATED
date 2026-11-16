import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { registerHooks } from "node:module";
import { UserManagement } from "../src/components/user-management";
import { demoWorkspace } from "../src/lib/demo";

const cssHook = registerHooks({
  load(url, context, nextLoad) {
    return url.endsWith(".css")
      ? { format: "module", source: "", shortCircuit: true }
      : nextLoad(url, context);
  },
});
const { default: CRM } = await import("../src/components/crm");
cssHook.deregister();

test("users UI: every non-admin/inactive role has no module controls or navigation", () => {
  for (const role of [
    "seller",
    "seller_admin",
    "closer",
    "closer_admin",
    "superadmin",
  ] as const) {
    const data = demoWorkspace();
    data.profile = { ...data.profile, role, active: role !== "superadmin" };
    const html = renderToStaticMarkup(
      <UserManagement
        profile={data.profile}
        locale="es"
        demo
        profiles={data.profiles}
      />,
    );
    assert(html.includes("Acceso restringido"));
    assert(!html.includes("Crear usuario"));
    assert(!html.includes("fixture-secret"));
  }
  const data = demoWorkspace();
  data.profile.role = "seller";
  assert(
    !renderToStaticMarkup(<CRM initial={data} />).includes(
      "<span>Usuarios</span>",
    ),
  );
});
test("users UI: authorized module renders Spanish/English labels, demo disabled creation and no secret retrieval on initial render", () => {
  const data = demoWorkspace();
  for (const locale of ["es", "en"] as const) {
    const html = renderToStaticMarkup(
      <UserManagement
        profile={{ ...data.profile, active: true }}
        locale={locale}
        demo
        profiles={data.profiles}
      />,
    );
    assert(
      html.includes(
        locale === "es" ? "Usuarios y accesos" : "Users and access",
      ),
    );
    assert(
      html.includes(
        locale === "es"
          ? "Buscar por nombre o correo"
          : "Search by name or email",
      ),
    );
    assert.match(
      html,
      /<button[^>]*disabled=""[\s\S]*?(Crear usuario|Create user)/,
    );
    assert(!html.includes('name="password"'));
    assert(!html.includes('type="password"'));
  }
});
