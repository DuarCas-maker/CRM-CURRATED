import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposioAccountBindingsV2 } from "../src/components/composio-account-bindings-v2";

test("I04 UI has explicit read/check/confirm actions, no Google project or secret input, ES/EN and access gating", () => {
  const props = {
    locale: "es" as const,
    allowed: true,
    demo: false,
    accounts: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        email: "pilot@example.test",
      },
    ],
  };
  const es = renderToStaticMarkup(
    createElement(ComposioAccountBindingsV2, props),
  );
  assert.match(es, /Asociación de Gmail con Composio/);
  assert.match(es, /Actualizar revisión/);
  assert.match(es, /Gmail directo se conserva/);
  assert.equal(
    /google_quota_project_id|api_key|COMPOSIO_API_KEY/.test(es),
    false,
  );
  assert.match(es, /aria-labelledby=/);
  assert.match(es, /<label/);
  const en = renderToStaticMarkup(
    createElement(ComposioAccountBindingsV2, { ...props, locale: "en" }),
  );
  assert.match(en, /Gmail binding with Composio/);
  assert.equal(
    renderToStaticMarkup(
      createElement(ComposioAccountBindingsV2, { ...props, allowed: false }),
    ),
    "",
  );
  assert.equal(
    renderToStaticMarkup(
      createElement(ComposioAccountBindingsV2, { ...props, demo: true }),
    ),
    "",
  );
});
