import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  lenderTemplateSchema,
  lenderTemplateValues,
  renderLenderMessage,
  messagePreviewDocument,
} from "../src/lib/lender-templates";
import { outgoingMailSchema } from "../src/lib/mail-manager";
import {
  filterRecipientLenders,
  recipientIssues,
  recipientSelectionSchema,
} from "../src/lib/mail-recipient-selections";
import { buildMime } from "../worker/mime";

test("AC002: entire active catalog includes lenders without contacts; no 20 cap in mail or saved selections", () => {
  const lenders = Array.from({ length: 173 }, (_, n) => ({
    id: randomUUID(),
    name: "Fictional " + n,
    email: n ? `lender${n}@example.test` : "",
  }));
  const contacts = lenders
    .slice(1)
    .map((l) => ({ lender_id: l.id, email: l.email }));
  assert.equal(
    filterRecipientLenders({ lenders, contacts }, "", "asc", "es").length,
    173,
  );
  const targets = lenders
    .slice(1)
    .map((l) => ({ lender_id: l.id, email: l.email, cc_emails: [] }));
  const mail = {
    opportunity_id: randomUUID(),
    account_id: randomUUID(),
    mode: "lenders",
    to_email: targets[0].email,
    subject: "Hello {{company}}",
    body: "Please review",
    process_id: randomUUID(),
    targets,
  };
  assert.equal(outgoingMailSchema.parse(mail).targets.length, 172);
  assert.equal(
    recipientSelectionSchema.parse({ name: "All", targets }).targets.length,
    172,
  );
  assert.equal(
    recipientIssues(
      [{ lender_id: lenders[0].id, email: "", cc_emails: [] }, ...targets],
      { lenders, contacts },
    ).length,
    1,
  );
  assert.equal(
    outgoingMailSchema.safeParse({ ...mail, targets: [targets[0], targets[0]] })
      .success,
    false,
  );
  assert.equal(
    outgoingMailSchema.safeParse({ ...mail, mode: "compose" }).success,
    false,
    "Changing audience must not send unresolved lender variables",
  );
  assert.equal(
    outgoingMailSchema.safeParse({
      ...mail,
      mode: "forward",
      forward_message_id: randomUUID(),
    }).success,
    true,
    "Forwarded historical text remains literal, including merge-field examples",
  );
  assert.equal(
    outgoingMailSchema.safeParse({
      ...mail,
      cc_emails: ["shared@example.test"],
    }).success,
    false,
  );
  assert.equal(
    outgoingMailSchema.safeParse({
      ...mail,
      targets: [
        {
          ...targets[0],
          cc_emails: Array.from(
            { length: 21 },
            (_, n) => `copy${n}@example.test`,
          ),
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    recipientIssues(
      [{ lender_id: lenders[1].id, email: "bad", cc_emails: [] }],
      { lenders, contacts: [{ lender_id: lenders[1].id, email: "bad" }] },
    ).length,
    1,
  );
});

test("AC006: case and lender values resolve consistently; missing/unknown/campaign fields are explicit and malformed braces blocked", () => {
  const values = lenderTemplateValues(
    { company: "Fixture LLC", contact: "Alex", amount: 50000 },
    "Example Lender",
  );
  const p = renderLenderMessage(
    {
      subject: "{{company}} to {{lender_name}}",
      body: "Hello {{name}}, {{amount}}",
    },
    values,
  );
  assert.equal(p.subject, "Fixture LLC to Example Lender");
  assert.equal(p.body, "Hello Alex, $50,000.00");
  assert.deepEqual(p.missing, []);
  const missing = renderLenderMessage(
    {
      subject: "{{company}}",
      body: "{{phone}} {{unsubscribe_url}} {{application_url}} {{unknown}}",
    },
    values,
  );
  assert.deepEqual(missing.missing, [
    "phone",
    "unsubscribe_url",
    "application_url",
    "unknown",
  ]);
  assert.match(missing.body, /Falta: phone/);
  assert.ok(
    renderLenderMessage({ subject: "{{company}", body: "Hello" }, values).error,
  );
  assert.ok(
    renderLenderMessage(
      { subject: "{{company}}", body: "Hello" },
      { company: "Test\nBcc: injected" },
    ).error,
  );
  assert.ok(
    renderLenderMessage(
      { subject: "{{company}}", body: "Hello" },
      { company: "a".repeat(201) },
    ).error,
  );
});

test("AC006/007: merge values cannot introduce HTML/Markdown; preview and MIME use identical formatted body and signature only once", () => {
  const body = "**{{company}}**\n:::signature\nAgent Example\n:::";
  const rendered = renderLenderMessage(
    { subject: "Review", body, body_format: "markdown" },
    {
      company: "<img src=x onerror=alert(1)> **bold** [fake](javascript:alert)",
    },
  );
  assert.equal(rendered.error, "");
  assert.match(rendered.html, /&lt;img/);
  assert.doesNotMatch(rendered.html, /<img|href="javascript|<strong>bold/);
  const doc = messagePreviewDocument(rendered.html, "GMAIL_SIGNATURE");
  assert.doesNotMatch(doc, /GMAIL_SIGNATURE/);
  assert.match(doc, /default-src 'none'/);
  const raw = Buffer.from(
    buildMime({
      from: "sender@example.test",
      to: "lender@example.test",
      subject: rendered.subject,
      body: rendered.body,
      bodyHtml: rendered.html,
      signatureHtml: undefined,
      messageId: "<fictional@example.test>",
    }),
    "base64url",
  ).toString();
  const alternatives = [
    ...raw.matchAll(
      /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g,
    ),
  ].map((m) => Buffer.from(m[1], "base64").toString());
  assert.ok(alternatives.includes(`<div>${rendered.html}</div>`));
  assert.equal(
    renderLenderMessage(
      {
        subject: "Hello",
        body: "[link](javascript:alert)",
        body_format: "markdown",
      },
      {},
    ).error.length > 0,
    true,
  );
});

test("AC004/005: templates persist source variables only; no steps/assets/client values; lender fields need no unsubscribe URL", () => {
  const p = lenderTemplateSchema.parse({
    id: randomUUID(),
    expected_version: 0,
    name: "Lender proposal",
    subject: "{{company}}",
    body: "Hello {{lender_name}}, {{amount}}",
    steps: [{ body: "Never copied" }],
    asset_ids: [randomUUID()],
  });
  assert.equal(p.subject, "{{company}}");
  assert.equal("asset_ids" in p, false);
  assert.equal("steps" in p, false);
  assert.equal(
    lenderTemplateSchema.safeParse({ ...p, body: "{{unsubscribe_url}}" })
      .success,
    false,
  );
});
