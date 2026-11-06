import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MailEditor } from "../src/components/mail-editor";
import { demoWorkspace } from "../src/lib/demo";
import { fakeBrandEnvelope } from "./fixtures/pipeline-os-s02-brand-delivery";
import { snapshotPreparation } from "../src/lib/brand-delivery";
function render(
  options: {
    advanced?: boolean;
    authorized?: boolean;
    demo?: boolean;
    lender?: boolean;
    reviewed?: boolean;
  } = {},
) {
  const data = demoWorkspace();
  data.demo = options.demo || false;
  data.gmail_history_enabled = options.advanced || false;
  const co = data.conversations[0];
  const preparation = snapshotPreparation(
    fakeBrandEnvelope("00000000-0000-4000-8000-000000000001").brand_snapshot,
  )!;
  data.accounts[0].brand_context = {
    ...preparation,
    account_id: co.account_id,
    brand_code: "FIXTURE",
    brand_name: "Fixture brand",
    can_campaign: false,
  };
  data.accounts[0].status = options.demo ? "demo" : "connected";
  data.sender_account_ids = options.authorized === false ? [] : [co.account_id];
  return renderToStaticMarkup(
    createElement(MailEditor, {
      data,
      locale: "es",
      act: async () => undefined,
      busy: false,
      close: () => {},
      compact: true,
      inline: true,
      opportunity: data.opportunities.find((o) => o.id === co.opportunity_id),
      start: {
        brand_preparation: options.reviewed === false ? undefined : preparation,
        mode: "reply",
        account_id: co.account_id,
        opportunity_id: co.opportunity_id,
        conversation_id: co.id,
        subject: co.subject,
        to_email: "customer@example.com",
        lender_id: options.lender
          ? "00000000-0000-4000-8000-000000000001"
          : undefined,
      },
    }),
  );
}
const submit = (html: string) =>
  html.match(/<button\b[^>]*>Enviar respuesta<\/button>/)?.[0] || "";
test("basic replies remain available without an advanced Gmail signature or unsupported recipient controls", () => {
  const html = render();
  assert(submit(html));
  assert(!submit(html).includes("disabled"));
  assert(!html.includes("CC, CCO y registro de contacto"));
  assert(!html.includes("Enviar desde"));
  assert(html.includes("cuenta original del hilo"));
});
test("basic replies cannot fall back to an unpermitted original mailbox", () => {
  assert(submit(render({ authorized: false })).includes("disabled"));
});
test("advanced replies retain sender, copies, attachments and the signature readiness requirement", () => {
  const html = render({ advanced: true });
  assert(html.includes("Enviar desde"));
  assert(html.includes("CC, CCO y registro de contacto"));
  assert(html.includes("Adjuntos y firma"));
  assert(submit(html).includes("disabled"));
});
test("explicit demo mailbox status still permits the existing simulated reply", () => {
  assert(!submit(render({ demo: true })).includes("disabled"));
});
test("company replies expose the reviewed recipient, copies and authorized account without requiring the advanced signature feature", () => {
  const html = render({ lender: true });
  assert(!submit(html).includes("disabled"));
  assert(html.includes("Enviar desde"));
  assert(html.includes("CC y CCO"));
  assert(!html.includes("Registrar destinatario"));
  assert(!html.includes("Documentos del expediente"));
  assert(!html.includes("Vista previa de la firma"));
  assert(
    submit(render({ lender: true, authorized: false })).includes("disabled"),
  );
});

test("reply modes require an explicit brand review even with a technically permitted sender", () => {
  for (const options of [
    {},
    { demo: true },
    { lender: true },
    { advanced: true },
  ])
    assert(
      submit(render({ ...options, reviewed: false })).includes("disabled"),
    );
});
