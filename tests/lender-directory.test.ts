import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  lenderDirectorySchema,
  lenderPortalNotes,
  lenderPortalUrl,
} from "../src/lib/lender-directory";
import { lenderEmailResolver } from "../src/lib/lender-mail";
import { LenderForm } from "../src/components/lender-form";
test("portal entries use the supplied HTTPS URL without requiring an invented email or products", () => {
  const result = lenderDirectorySchema.parse({
    name: "Idea",
    channel: "portal",
    email: "",
    products: "",
    portal_url: "https://partner.ideafinancial.us/sign-in",
    notes: "Cuenta de presentación",
  });
  assert.equal(result.email, "");
  assert.equal(result.products, "");
  assert.equal(
    lenderPortalUrl(result.notes),
    "https://partner.ideafinancial.us/sign-in",
  );
  assert.match(result.notes, /Cuenta de presentación/);
  assert.equal(
    lenderPortalUrl(
      "Documentos: https://docs.example.test\nPortal: https://portal.example.test",
    ),
    "https://portal.example.test",
  );
  const html = renderToStaticMarkup(
    createElement(LenderForm, {
      lender: {
        id: "idea",
        name: "Idea",
        email: "",
        channel: "portal",
        products: [],
        notes: result.notes,
      },
      locale: "es",
      busy: false,
      submit: () => {},
    }),
  );
  assert(!/<input(?=[^>]*name="email")(?=[^>]*\brequired)[^>]*>/.test(html));
  assert(
    /<input(?=[^>]*name="portal_url")(?=[^>]*\brequired)[^>]*>/.test(html),
  );
});
test("email channels require an address, internal addresses stay excluded, and unsafe portal links are rejected", () => {
  assert(
    !lenderDirectorySchema.safeParse({
      name: "Company",
      channel: "email",
      email: "",
    }).success,
  );
  for (const portal_url of [
    "http://portal.example.com",
    "javascript:alert(1)",
    "https://user:password@portal.example.com",
  ])
    assert(
      !lenderDirectorySchema.safeParse({
        name: "Company",
        channel: "portal",
        portal_url,
      }).success,
    );
  assert(
    !lenderDirectorySchema.safeParse({
      name: "Ricardo",
      channel: "email",
      email: "ricardo@curatedfinancial.com",
    }).success,
  );
  const resolve = lenderEmailResolver({
    lenders: [
      { id: "incorrect", name: "Wrong", email: "ricardo@curatedfinancial.com" },
    ],
    lender_contacts: [],
    team_emails: [],
    client_emails: [],
  });
  assert.equal(resolve("ricardo@curatedfinancial.com"), undefined);
  assert.equal(resolve("someone@curatedfinancial.com"), undefined);
  assert.equal(
    lenderPortalNotes(
      "Nota\nPortal: https://old.example.com",
      "https://new.example.com",
    ),
    "Nota\nPortal: https://new.example.com",
  );
});
