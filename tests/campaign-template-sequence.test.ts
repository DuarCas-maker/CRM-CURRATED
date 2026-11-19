import test from "node:test";
import assert from "node:assert/strict";
import { flowFixture } from "./fixtures/campaign-flow";
import { exerciseTemplateSequence } from "./fixtures/campaign-template-sequence";
import { buildMime } from "../worker/mime";
import { renderCampaignContent } from "../src/lib/campaign-content";
import { campaignPreviewValues } from "../src/lib/campaign-templates";
import {
  automaticSignatureTemplate,
  templateReminders,
  defaultReminders,
  withoutInlineSignature,
} from "../src/lib/campaign-sequence";
test("sequence defaults, per-step edits and automatic signature preserve commercial content", () => {
  assert.equal(defaultReminders.length, 4);
  assert.deepEqual(
    defaultReminders.map((s) => s.wait_days),
    [2, 3, 3, 5],
  );
  assert(
    defaultReminders.every(
      (s) => s.body.startsWith("Hi,") && s.body.includes("{{unsubscribe_url}}"),
    ),
  );
  const original =
    "Offer\r\n\r\n:::signature\r\nFixed name\r\n:::\r\n\r\nUnsubscribe {{unsubscribe_url}}";
  assert(!withoutInlineSignature(original, "markdown").includes("Fixed name"));
  assert.equal(withoutInlineSignature(original, "plain"), original);
  const custom = templateReminders([
    {
      subject: "Edited reminder",
      body: "Body {{unsubscribe_url}}",
      wait_days: 9,
    },
  ]);
  assert.equal(custom[0].subject, "Edited reminder");
  assert.deepEqual(
    custom.map((s) => s.wait_days),
    [2, 3, 3, 5],
  );
  const normalized = automaticSignatureTemplate({
    body: original,
    body_format: "markdown",
    steps: [{ subject: "Subject", body: original, wait_days: 2 }],
  });
  assert(!normalized.body.includes("Fixed name"));
  assert(!normalized.steps[0].body.includes("Fixed name"));
});
test("sequence SQL permissions, version history, snapshot preservation and reversal", async () => {
  const f = await flowFixture();
  try {
    assert((await exerciseTemplateSequence(f)).passed);
  } finally {
    await f.db.close();
  }
});
test("all four reminders keep the selected Gmail signature exactly once in MIME", () => {
  for (const message of defaultReminders) {
    const content = renderCampaignContent(
      message.body,
      campaignPreviewValues,
      "markdown",
    );
    assert(!content.html.includes('data-crm-signature="true"'));
    const mime = Buffer.from(
      buildMime({
        from: "sender@example.test",
        to: "lead@example.test",
        subject: message.subject,
        body: content.text,
        bodyHtml: content.html,
        signatureHtml: "<b>Selected Sender</b>",
        messageId: "<fixture@example.test>",
      }),
      "base64url",
    ).toString();
    const encoded = mime.match(
      /Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/,
    )?.[1];
    assert(encoded);
    const html = Buffer.from(encoded, "base64").toString();
    assert.equal(html.split("Selected Sender").length - 1, 1);
    assert(!html.includes("Daniel Duarcas"));
  }
});
