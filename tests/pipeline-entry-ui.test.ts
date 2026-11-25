import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerHooks } from "node:module";
import { pipelineModuleDemo } from "../src/lib/pipeline-os/demo";
test("an unavailable board keeps navigation and never renders partial totals as complete", async () => {
  const hook = registerHooks({ load(url, context, next) { return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context); } });
  const { PipelineOSWorkspace } = await import("../src/components/pipeline-os/workspace");
  hook.deregister();
  const { data } = pipelineModuleDemo(); data.demo = false;
  const html = renderToStaticMarkup(createElement(PipelineOSWorkspace, { initial: data }));
  assert.match(html, /Campañas/); assert.match(html, /aria-controls="pos-tree"/);
  const values = [...html.matchAll(/class="pos-tile-number">([^<]*)</g)].map(m => m[1]);
  assert(values.length >= 6); assert(values.every(value => value === "—" || value === "Aa"));
  assert.doesNotMatch(html, /Sin acciones pendientes en esta vista/);
});
