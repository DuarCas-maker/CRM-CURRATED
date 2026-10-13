import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MailEditor } from "../src/components/mail-editor";
import { demoWorkspace } from "../src/lib/demo";
function render(
  options: { advanced?: boolean; authorized?: boolean; demo?: boolean } = {},
) {
  const data = demoWorkspace();
  data.demo = options.demo || false;
  data.gmail_history_enabled = options.advanced || false;
  const co = data.conversations[0];
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
        mode: "reply",
        account_id: co.account_id,
        opportunity_id: co.opportunity_id,
        conversation_id: co.id,
        subject: co.subject,
        to_email: "customer@example.com",
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
