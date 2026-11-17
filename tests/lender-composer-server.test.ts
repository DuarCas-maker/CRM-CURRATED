import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareLenderReview } from "../src/lib/server/lender-preview";
import { outgoingMailSchema } from "../src/lib/mail-manager";
import { readFileSync } from "node:fs";

test("AC007: review uses authorized records, changes digest on context/content/attachment/signature drift, and never writes", async () => {
  const lender = randomUUID();
  const opportunity = {
    company: "Fictional LLC",
    contact: "Alex",
    amount: 75000,
    phone: "",
  };
  const contact = { lender_id: lender, email: "lender@example.test" };
  let selects = 0;
  const db = {
    from: (table: string) => {
      selects++;
      const result = {
        data:
          table === "opportunity_workspace"
            ? opportunity
            : table === "lenders"
              ? [{ id: lender, name: "Fictional Lender", email: contact.email }]
              : [contact],
        error: null,
      };
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        single: async () => result,
        range: async () => result,
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const p = outgoingMailSchema.parse({
    mode: "lenders",
    opportunity_id: randomUUID(),
    account_id: randomUUID(),
    process_id: randomUUID(),
    to_email: contact.email,
    subject: "{{company}}",
    body: "For {{lender_name}}: {{amount}}",
    targets: [{ lender_id: lender, email: contact.email }],
  });
  const sig = { html: "<b>Agent</b>", name: "Agent Example" };
  const original = await prepareLenderReview(db, p, sig);
  assert.equal(original.messages[0].body, "For Fictional Lender: $75,000.00");
  assert.equal(
    (
      await prepareLenderReview(
        db,
        { ...p, lender_review_digest: original.digest },
        sig,
      )
    ).digest,
    original.digest,
  );
  for (const changed of [
    { ...p, attachment_ids: [randomUUID()] },
    { ...p, body: "Edited" },
    { ...p, process_id: randomUUID() },
  ])
    assert.notEqual(
      (await prepareLenderReview(db, changed, sig)).digest,
      original.digest,
    );
  assert.notEqual(
    (await prepareLenderReview(db, p, { ...sig, html: "Updated" })).digest,
    original.digest,
  );
  opportunity.amount = 76000;
  assert.notEqual(
    (await prepareLenderReview(db, p, sig)).digest,
    original.digest,
  );
  await assert.rejects(
    () => prepareLenderReview(db, { ...p, body: "{{phone}}" }, sig),
    /phone/,
  );
  contact.email = "changed@example.test";
  await assert.rejects(
    () => prepareLenderReview(db, p, sig),
    /contacto válido/,
  );
  assert.ok(selects > 0);
});

test("AC007: send compares review before queue; preview/template routes preserve origin/MFA auth, bounded input, no-store and write roles", () => {
  const send = readFileSync("src/lib/server/mail-manager.ts", "utf8");
  assert.ok(
    send.indexOf("input.lender_review_digest !== review.digest") <
      send.indexOf('"queue_mail_lenders"'),
  );
  assert.match(
    send,
    /subject_text: rendered.subject,\s*body_text: rendered.body,\s*body_html: rendered.html/,
  );
  for (const file of [
    "src/app/api/mail/lender-preview/route.ts",
    "src/app/api/mail/templates/route.ts",
  ]) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /checkOrigin\(request\)/);
    assert.match(text, /await requireUser\(\)/);
    assert.match(text, /readBounded/);
    assert.match(text, /no-store/);
    assert.doesNotMatch(text, /mail_send|queueBrandMail|queue_mail_lenders/);
  }
});
