import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import {
  MailTransportSettings,
  MailTransportSettingsView,
  transportChoices,
} from "../src/components/mail-transport-settings";
import {
  transportReview,
  type TransportReview,
} from "../src/lib/mail-transport-selection";
export function reviewFixture(): TransportReview {
  return {
    selection: {
      account_id: randomUUID(),
      provider: "gmail_oauth",
      state: "ready",
      revision: 1,
      target_provider: null,
      binding_id: null,
    },
    expected: {
      expected_revision: 1,
      expected_head_revision: 0,
      expected_account_revision: 1,
      expected_brand_revision: 1,
      expected_config_generation: 0,
      expected_context_hash: "a".repeat(64),
    },
    receive_enabled: true,
    unresolved: false,
    current: true,
    eligible_direct: true,
    binding_verified: true,
    composio_enabled: false,
  };
}
test("R06-I03 panel distinguishes verified binding from blocked Composio and receiving state in ES/EN", () => {
  for (const locale of ["es", "en"] as const) {
    const review = reviewFixture();
    review.selection!.provider = "composio";
    review.selection!.binding_id = randomUUID();
    const html = renderToStaticMarkup(
      h(MailTransportSettingsView, {
        locale,
        accounts: [
          {
            id: review.selection!.account_id,
            email: "long.mailbox.name.with.context@fiction.test",
          },
        ],
        account: review.selection!.account_id,
        review,
        loading: false,
        busy: false,
        error: "",
        fresh: true,
        onAccount() {},
        onChoose() {},
        onRefresh() {},
      }),
    );
    assert.match(html, locale === "es" ? /Verificada/ : /Verified/);
    assert.match(
      html,
      locale === "es"
        ? /No habilitada para sincronización/
        : /Not enabled for sync/,
    );
    assert.match(
      html,
      locale === "es"
        ? /Composio sigue deshabilitada/
        : /Composio operation remains disabled/,
    );
    assert.equal(
      transportChoices(review, locale).some(
        (c) =>
          c.target === "composio" &&
          !["pause", "cancel_transition"].includes(c.kind),
      ),
      false,
    );
    assert(!html.includes(review.expected.expected_context_hash));
    assert(!html.includes(review.selection!.binding_id!));
  }
});
test("R06-I03 selection, pause and resume are explicit separate commands", () => {
  const review = reviewFixture();
  review.selection = null;
  assert.deepEqual(
    transportChoices(review, "es").map((c) => c.kind),
    ["bootstrap_direct"],
  );
  review.selection = {
    account_id: randomUUID(),
    provider: "gmail_oauth",
    state: "paused",
    revision: 2,
    target_provider: null,
    binding_id: null,
  };
  assert.deepEqual(
    transportChoices(review, "es").map((c) => c.kind),
    ["prepare_transition"],
  );
  review.selection.state = "draining";
  review.selection.target_provider = "gmail_oauth";
  assert.deepEqual(
    transportChoices(review, "en").map((c) => c.kind),
    ["pause", "cancel_transition", "commit_transition"],
  );
  review.selection.target_provider = "composio";
  assert.equal(
    transportChoices(review, "en").some((c) => c.kind === "commit_transition"),
    false,
  );
  review.selection.target_provider = "gmail_oauth";
  review.unresolved = true;
  assert.equal(
    transportChoices(review, "es").some((c) => c.kind === "commit_transition"),
    false,
  );
});
test("R06-I03 admin-only panel has no default mailbox, demo or non-admin network surface", () => {
  const props = {
    accounts: [{ id: randomUUID(), email: "fiction@fiction.test" }],
    locale: "es" as const,
    demo: false,
    allowed: true,
  };
  assert.equal(
    renderToStaticMarkup(
      h(MailTransportSettings, { ...props, allowed: false }),
    ),
    "",
  );
  assert.equal(
    renderToStaticMarkup(h(MailTransportSettings, { ...props, demo: true })),
    "",
  );
  const html = renderToStaticMarkup(h(MailTransportSettings, props));
  assert.match(html, /<option value="" selected="">/);
  assert(!html.includes("Confirmar cambio"));
});
test("R06-I03 review contract rejects private extras and unsafe CAS numbers", () => {
  assert.equal(
    transportReview.safeParse({ ...reviewFixture(), token_hash: "secret" })
      .success,
    false,
  );
  const review = reviewFixture();
  review.expected.expected_revision = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(transportReview.safeParse(review).success, false);
});
