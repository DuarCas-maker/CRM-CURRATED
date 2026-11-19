import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { demoWorkspace } from "../src/lib/demo";
import { demoFinancingControl } from "../src/lib/financing-control";
const css = registerHooks({
  load(url, context, next) {
    return url.endsWith(".css")
      ? { format: "module", source: "", shortCircuit: true }
      : next(url, context);
  },
});
const { default: CRM } = await import("../src/components/crm");
css.deregister();

test("the live CRM first render is identical in server and browser time zones", () => {
  const previous = process.env.TZ;
  try {
    for (const locale of ["es", "en"] as const) {
      const data = demoWorkspace();
      data.demo = false;
      data.preferences.locale = locale;
      data.financing_control = demoFinancingControl(
        data,
        data.opportunities,
        "all",
        0,
      );
      data.financing_control.as_of = "2026-11-19T02:00:00Z";
      const markup = (zone: string) => {
        process.env.TZ = zone;
        return createHash("sha256")
          .update(renderToStaticMarkup(<CRM initial={data} />))
          .digest("hex");
      };
      assert.equal(
        markup("UTC"),
        markup("America/Bogota"),
        locale + " must not require React to discard server HTML",
      );
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
