import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoWorkspace } from "../src/lib/demo";
import { MailEditor } from "../src/components/mail-editor";
import {
  filterRecipientLenders,
  lenderContacts,
  recipientIssues,
  recipientSelectionSchema,
  type RecipientDirectory,
} from "../src/lib/mail-recipient-selections";
import {
  availableMailAttachments,
  selectAllMailAttachments,
} from "../src/lib/mail-editor-attachments";

const a = randomUUID(),
  b = randomUUID(),
  inactive = randomUUID();
const directory: RecipientDirectory = {
  lenders: [
    { id: b, name: "Beta", email: "b@beta.test" },
    { id: a, name: "Alpha", email: "a@alpha.test" },
    {
      id: inactive,
      name: "Archived",
      email: "old@old.test",
      archived_at: "2026-10-19",
    },
  ],
  contacts: [
    { lender_id: a, email: "a@alpha.test", name: "Alice" },
    { lender_id: a, email: "copy@alpha.test" },
    { lender_id: a, email: "inactive@alpha.test", active: false },
    { lender_id: b, email: "b@beta.test" },
    { lender_id: inactive, email: "old@old.test" },
  ],
};
test("search and sort use active companies and their contacts", () => {
  assert.deepEqual(
    filterRecipientLenders(directory, "", "asc", "en").map((l) => l.id),
    [a, b],
  );
  assert.deepEqual(
    filterRecipientLenders(directory, "", "desc", "es").map((l) => l.id),
    [b, a],
  );
  assert.deepEqual(
    filterRecipientLenders(directory, "  ALICE  ", "asc", "en").map(
      (l) => l.id,
    ),
    [a],
  );
  assert.deepEqual(lenderContacts(directory, inactive), []);
  assert.equal(lenderContacts(directory, a).length, 2);
});
test("saved selections reject malformed, duplicate or excessive recipients and omit message templates", () => {
  const target = {
    lender_id: a,
    email: " A@alpha.test ",
    cc_emails: ["COPY@alpha.test"],
  };
  const parsed = recipientSelectionSchema.parse({
    name: " Personal ",
    targets: [target],
    subject: "Not saved",
    body: "Not saved",
  });
  assert.deepEqual(parsed, {
    name: "Personal",
    targets: [
      { ...target, email: "a@alpha.test", cc_emails: ["copy@alpha.test"] },
    ],
  });
  assert(
    !recipientSelectionSchema.safeParse({ name: " ", targets: [target] })
      .success,
  );
  assert(
    !recipientSelectionSchema.safeParse({
      name: "x",
      targets: [target, target],
    }).success,
  );
  assert(
    !recipientSelectionSchema.safeParse({
      name: "x",
      targets: Array.from({ length: 21 }, () => ({
        ...target,
        lender_id: randomUUID(),
      })),
    }).success,
  );
  assert(
    !recipientSelectionSchema.safeParse({
      name: "x",
      targets: [{ ...target, cc_emails: ["invalid"] }],
    }).success,
  );
});
test("deleted, inactive and reassigned recipients are detected without substituting a different address", () => {
  const target = {
    lender_id: a,
    email: "a@alpha.test",
    cc_emails: ["copy@alpha.test"],
  };
  assert.deepEqual(recipientIssues([target], directory), []);
  for (const email of [
    "deleted@alpha.test",
    "inactive@alpha.test",
    "b@beta.test",
  ]) {
    assert.deepEqual(
      recipientIssues([{ ...target, cc_emails: [email] }], directory),
      [{ lender_id: a, email, reason: "contact" }],
    );
    assert.equal(recipientIssues([{ ...target, email }], directory).length, 1);
  }
  assert.deepEqual(
    recipientIssues([{ ...target, lender_id: inactive }], directory),
    [{ lender_id: inactive, email: "", reason: "lender" }],
  );
  assert.equal(target.email, "a@alpha.test");
});
test("bulk file selection keeps approval, case and storage rules and counts other attachments", () => {
  const data = demoWorkspace();
  const caseId = data.opportunities[0].id;
  const base = data.documents[0];
  data.documents = [
    {
      ...base,
      id: "approved",
      opportunity_id: caseId,
      status: "approved",
      storage_path: "v2/file",
    },
    {
      ...base,
      id: "pending",
      opportunity_id: caseId,
      status: "pending",
      storage_path: "file",
    },
    {
      ...base,
      id: "foreign",
      opportunity_id: "other",
      status: "approved",
      storage_path: "file",
    },
    {
      ...base,
      id: "empty",
      opportunity_id: caseId,
      status: "approved",
      storage_path: "",
    },
  ];
  data.gmail_history_enabled = true;
  data.gmail_files = [
    {
      id: "gmail",
      archive_message_id: "original",
      opportunity_id: caseId,
      name: "file",
      storage_path: "saved",
      status: "received",
    },
    {
      id: "blocked",
      archive_message_id: "original",
      opportunity_id: caseId,
      name: "blocked",
      storage_path: "saved",
      status: "pending",
    },
  ];
  const available = availableMailAttachments(data, caseId);
  assert.deepEqual(
    available.documents.map((d) => d.id),
    ["approved"],
  );
  assert.deepEqual(
    available.gmailFiles.map((f) => f.id),
    ["gmail"],
  );
  const selected = {
    documents: ["approved"],
    gmailFiles: [],
    uploads: 1,
    forwards: 1,
  };
  assert.deepEqual(selectAllMailAttachments(available, selected), {
    documents: ["approved"],
    gmailFiles: ["gmail"],
  });
  assert.equal(
    selectAllMailAttachments(available, { ...selected, uploads: 19 }),
    null,
  );
  assert.equal(
    selectAllMailAttachments(available, {
      ...selected,
      gmailFiles: Array.from({ length: 10 }, (_, i) => `g${i}`),
    }),
    null,
  );
  data.gmail_history_enabled = false;
  assert.deepEqual(availableMailAttachments(data, caseId).gmailFiles, []);
});
test("shared composer renders only selected lender cards, separate CC and explicit scope in both languages", () => {
  for (const locale of ["es", "en"] as const) {
    const data = demoWorkspace();
    data.lenders = directory.lenders
      .filter((l) => !l.archived_at)
      .map((l) => ({ ...l, products: [], channel: "email", notes: "" }));
    data.lender_contacts = directory.contacts;
    const html = renderToStaticMarkup(
      createElement(MailEditor, {
        data,
        locale,
        busy: false,
        close() {},
        act: async () => undefined,
        start: {
          mode: "lenders",
          targets: [
            {
              lender_id: a,
              email: "a@alpha.test",
              cc_emails: ["copy@alpha.test"],
            },
          ],
        },
      }),
    );
    assert.equal((html.match(/class="mail-recipient-card"/g) || []).length, 1);
    assert(html.includes("<legend>Alpha</legend>"));
    assert(!html.includes("<legend>Beta</legend>"));
    assert(
      html.includes('value="copy@alpha.test"') ||
        html.includes("copy@alpha.test"),
    );
    assert(
      html
        .toLowerCase()
        .includes(locale === "es" ? "catálogo completo" : "entire catalog"),
    );
    assert(
      html.includes(
        locale === "es" ? "resultado filtrado" : "filtered results",
      ),
    );
    assert.match(
      html,
      /<details open=""><summary>(Documentos del expediente|Case documents)/,
    );
    assert.match(
      html,
      /<details><summary>(Adjuntar desde el computador|Attach from computer)/,
    );
    const apply = html.match(
      /<button[^>]*>[^<]*(Aplicar y reemplazar destinatarios|Apply and replace recipients)<\/button>/,
    )?.[0];
    assert(apply?.includes('type="button"'));
  }
});
