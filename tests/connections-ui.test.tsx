import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { demoWorkspace } from "../src/lib/demo";
import { demoConnections, type ConnectionTab } from "../src/lib/connections";
import { ConnectionsWorkspace } from "../src/components/connections-workspace";
import { Integrations } from "../src/components/integrations";
import CRM from "../src/components/crm";

const act = async () => undefined;
const render = (
  locale: "es" | "en" = "es",
  tab: ConnectionTab = "composio",
) => {
  const data = demoWorkspace();
  data.profile.active = true;
  return renderToStaticMarkup(
    <ConnectionsWorkspace
      data={data}
      locale={locale}
      act={act}
      busy={false}
      initialSnapshot={demoConnections(data.accounts)}
      initialTab={tab}
    />,
  );
};
test("CON-AC01/02/04: module has four accessible provider tabs, source dates and operational separation", () => {
  const html = render();
  assert.equal((html.match(/role="tab"/g) || []).length, 4);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 4);
  for (const label of [
    "Composio",
    "Instantly",
    "TextTorrent",
    "Registro en CRM",
    "Última sincronización",
    "Mensajes en CRM",
    "Ver permisos",
    "Conectar correo",
  ])
    assert.ok(html.includes(label), label);
  assert.ok(html.includes("fecha de conexión externa no está disponible"));
  assert.ok(!html.includes("access_token"));
  assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*?Conectar correo/);
});
test("CON-AC05: TextTorrent remains pending and Instantly configuration does not claim live connectivity", () => {
  assert.ok(render("es", "texttorrent").includes("Integración pendiente"));
  assert.ok(render("en", "instantly").includes("Connection unverified"));
  assert.ok(
    render("en").includes("External connection date") ||
      render("en").includes("external connection date"),
  );
});
test("CON-AC06: other roles and inactive admins cannot render accounts or provider controls", () => {
  for (const p of [
    { role: "seller" as const, active: true },
    { role: "superadmin" as const, active: false },
  ]) {
    const data = demoWorkspace();
    Object.assign(data.profile, p);
    const html = renderToStaticMarkup(
      <ConnectionsWorkspace data={data} locale="es" act={act} busy={false} />,
    );
    assert.ok(html.includes("Acceso administrativo"));
    assert.ok(!html.includes(data.accounts[0].email));
    assert.ok(!html.includes("Conectar Gmail con Composio"));
  }
});
test("CON-AC01/04: settings retain roles while provider and sender controls are centralized", () => {
  const data = demoWorkspace();
  data.profile.active = true;
  const settings = renderToStaticMarkup(
    <Integrations data={data} locale="es" act={act} busy={false} />,
  );
  const access = renderToStaticMarkup(
    <Integrations
      data={data}
      locale="es"
      act={act}
      busy={false}
      area="access"
    />,
  );
  assert.ok(settings.includes("Roles del equipo"));
  assert.ok(!settings.includes("Conectar Gmail con Composio"));
  assert.ok(!settings.includes("Permisos de remitentes"));
  assert.ok(access.includes("Permisos de remitentes"));
  assert.ok(access.includes("Límites de envío"));
  assert.ok(!access.includes("Roles del equipo"));
});
test("CON-AC01/06: actual CRM menu exposes Connections to the admin and preserves existing sections", () => {
  const data = demoWorkspace();
  data.profile.active = true;
  const html = renderToStaticMarkup(<CRM initial={data} />);
  assert.ok(html.includes("Conexiones"));
  assert.ok(html.includes("Configuración"));
  assert.ok(html.includes("Conversaciones"));
  data.profile.role = "seller";
  assert.ok(
    !renderToStaticMarkup(<CRM initial={data} />).includes(">Conexiones<"),
  );
});
