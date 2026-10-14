import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  crmExtensionsReady,
  requireCrmExtensions,
} from "../src/lib/server/crm-readiness";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { UnderwritingWorkspace } from "../src/components/underwriting-workspace";
import { demoWorkspace } from "../src/lib/demo";
test("releases tolerate unapplied migrations without concealing transport or access errors", async () => {
  let mode = "missing";
  const db = createClient("https://readiness-fixture.example.test", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: async () =>
        mode === "missing"
          ? Response.json(
              { code: "PGRST205", message: "Missing relation" },
              { status: 404 },
            )
          : mode === "ready"
            ? Response.json([{ id: 1 }])
            : Response.json(
                { code: "42501", message: "Permission denied" },
                { status: 403 },
              ),
    },
  });
  assert.equal(await crmExtensionsReady(db), false);
  await assert.rejects(requireCrmExtensions(db), /027–031/);
  mode = "ready";
  assert.equal(await crmExtensionsReady(db), true);
  await requireCrmExtensions(db);
  mode = "error";
  await assert.rejects(crmExtensionsReady(db), /Permission denied/);
  const data = demoWorkspace();
  data.demo = false;
  data.crm_extensions_ready = false;
  const html = renderToStaticMarkup(
    createElement(UnderwritingWorkspace, {
      data,
      opportunity: data.opportunities[0],
      locale: "es",
      editable: true,
      refresh: async () => {},
    }),
  );
  assert.match(html, /pendiente de activación/);
  assert(!html.includes("Analizar documentos aprobados"));
});
