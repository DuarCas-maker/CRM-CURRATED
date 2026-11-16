import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerHooks } from "node:module";
import { pipelineModuleDemo } from "../src/lib/pipeline-os/demo";
import { masterDemoSource } from "../src/lib/pipeline-os/master-demo";
import {
  buildMasterPipeline,
  masterTabs,
} from "../src/lib/pipeline-os/master-pipeline";

test("all six Master views render semantic headers, safe text, and explicit unknowns in both languages", async () => {
  const hook = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "", shortCircuit: true }
        : next(url, context);
    },
  });
  const { MasterRows, MasterRepTable, MasterStats } =
    await import("../src/components/pipeline-os/master-pipeline");
  hook.deregister();
  for (const locale of ["es", "en"] as const) {
    const { data, processes } = pipelineModuleDemo();
    data.opportunities[0].company = "<img src=x onerror=alert(1)>";
    const s = masterDemoSource(data, processes);
    for (const tab of masterTabs) {
      const b = buildMasterPipeline(s, { tab });
      const html = renderToStaticMarkup(
        createElement(MasterRows, {
          dashboard: b,
          locale,
          open() {},
          mail() {},
        }),
      );
      assert(html.includes('scope="col"'));
      assert(!html.includes("<img src=x"));
      assert(!html.includes('onerror="'));
    }
    const b = buildMasterPipeline(s, {});
    const reps = renderToStaticMarkup(
      createElement(MasterRepTable, {
        dashboard: b,
        locale,
        owner: "all",
        onOwner() {},
      }),
    );
    assert(reps.includes('aria-pressed="false"'));
    assert(reps.includes('scope="row"'));
    assert(reps.includes("—"));
    const stats = renderToStaticMarkup(
      createElement(MasterStats, { dashboard: b, locale, owner: "all" }),
    );
    assert(stats.includes("UTC"));
    assert(stats.includes("<summary>"));
  }
});
test("demo source rejects live workspaces instead of fabricating live timestamps", () => {
  const { data } = pipelineModuleDemo();
  data.demo = false;
  assert.throws(() => masterDemoSource(data, []), /MASTER_DEMO_ONLY/);
});
