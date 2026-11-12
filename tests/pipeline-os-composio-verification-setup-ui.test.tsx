import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToString } from "react-dom/server";
import { ComposioVerificationSetup } from "../src/components/composio-verification-setup";
test("CT06 no admin control in demo or unauthorized UI; Spanish/English loading and separate action", () => {
  const props = {
    account: "11111111-1111-4111-8111-111111111111",
    locale: "es" as const,
    allowed: true,
    onLockChange() {},
    onChanged() {},
    reviewAction(f: () => void) {
      f();
    },
  };
  assert.equal(
    renderToString(<ComposioVerificationSetup {...props} allowed={false} />),
    "",
  );
  assert.equal(
    renderToString(<ComposioVerificationSetup {...props} demo />),
    "",
  );
  const es = renderToString(<ComposioVerificationSetup {...props} />);
  const en = renderToString(
    <ComposioVerificationSetup {...props} locale="en" />,
  );
  assert.match(es, /Preparar comprobación limitada/);
  assert.match(en, /Prepare limited verification/);
  assert.match(es, /Gmail directo se conserva/);
  assert.match(en, /Direct Gmail is preserved/);
});
test("CT07 new setup module cannot invoke provider/check, and product transport remains disabled", () => {
  const service = readFileSync(
    "src/lib/server/mail-accounts/composio-verification-setup.ts",
    "utf8",
  );
  assert.doesNotMatch(
    service,
    /\.apiKey\(|\.fetchImpl\(|bindingCheckV2\(|check_begin|check_admit|check_finish|check_context_v2/,
  );
  assert.match(
    readFileSync("src/lib/server/mail-transport/runtime-context.ts", "utf8"),
    /export const composioProductOperationEnabled = false/,
  );
});
