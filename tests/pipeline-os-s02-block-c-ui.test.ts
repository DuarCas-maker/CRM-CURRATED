import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ComposioAccountBindings,
  ComposioAccountBindingsView,
} from "../src/components/composio-account-bindings";
import {
  bindingPageSchema,
  bindingExpected,
  bindingRequest,
  parseBindingCommand,
  parseBindingQuery,
  type BindingPage,
} from "../src/lib/composio-bindings";
import { c1Candidate } from "./fixtures/pipeline-os-s02-composio-bindings";
const noop = () => {};
function fixture(count = 0): BindingPage {
  const history = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    revision: count - i,
    status: i ? ("superseded" as const) : ("candidate" as const),
    reason: i ? ("replaced" as const) : null,
    stale: false,
    created_at: "2026-10-31T14:00:00Z",
    reviewed_at: null,
    external_refs: {
      project: "…ject",
      auth_config: "…nfig",
      connection: "…tion",
      user: "…wner",
      quota: "…uota",
    },
  }));
  return {
    account: {
      id: randomUUID(),
      email: "long.account.name@fixture.test",
      brand_id: randomUUID(),
      brand_name: "Marca ficticia con un nombre extenso para revisión",
      brand_revision: 1,
      account_revision: 1,
      context_hash: "a".repeat(64),
      ready: true,
    },
    head_revision: count,
    transport: "gmail_oauth",
    composio_enabled: false,
    verification_available: false,
    can_confirm: false,
    current: history[0] || null,
    history,
    cursor: count === 100 ? "1:" + history[99].id : null,
  };
}
function props(page: BindingPage | null = null) {
  return {
    locale: "es" as const,
    allowed: true,
    accounts: page ? [{ id: page.account.id, email: page.account.email }] : [],
    accountId: page?.account.id || "",
    page,
    loading: false,
    busy: false,
    fresh: !!page,
    error: "",
    notice: "",
    onAccount: noop,
    onRefresh: noop,
    onMore: noop,
    onRegister: noop,
    onRevoke: noop,
  };
}
test("C1 DTO/parser rejects unknown proof/actor/secret fields and enforces roles of all five identifiers", () => {
  const page = fixture(),
    payload = { ...bindingExpected(page), ...c1Candidate },
    base = {
      kind: "register_candidate",
      payload,
      idempotency_key: randomUUID(),
    };
  assert.ok(parseBindingCommand(base));
  for (const extra of [
    { verified: true },
    { actor_id: randomUUID() },
    { api_key: "sentinel-secret" },
    { expected_mailbox_email: "other@fixture.test" },
  ])
    assert.equal(
      parseBindingCommand({ ...base, payload: { ...payload, ...extra } }),
      null,
    );
  for (const extra of [
    { auth_config_id: payload.connected_account_id },
    { connected_account_id: payload.auth_config_id },
    { composio_project_id: payload.auth_config_id },
    { composio_user_id: "" },
    { expected_head_revision: "0" },
  ])
    assert.equal(
      parseBindingCommand({ ...base, payload: { ...payload, ...extra } }),
      null,
    );
  assert.equal(
    bindingPageSchema.safeParse({ ...page, composio_enabled: true }).success,
    false,
  );
  assert.equal(
    bindingPageSchema.safeParse({ ...page, private_token: "secret" }).success,
    false,
  );
  assert.equal(
    parseBindingQuery(new URLSearchParams("limit=25&limit=25")),
    null,
  );
  assert.equal(parseBindingQuery(new URLSearchParams("cursor=1:bad")), null);
  assert.ok(parseBindingQuery(new URLSearchParams("limit=100")));
});
test("C1 retry keeps one key for the same normalized intent and changes key for another revision/account", () => {
  const page = fixture(),
    payload = { ...bindingExpected(page), ...c1Candidate };
  let generated = 0;
  const next = () => {
    generated++;
    return randomUUID();
  };
  const first = bindingRequest(
    null,
    page.account.id,
    "register_candidate",
    payload,
    next,
  );
  assert.equal(
    bindingRequest(first, page.account.id, "register_candidate", payload, next)
      .key,
    first.key,
  );
  assert.equal(generated, 1);
  assert.notEqual(
    bindingRequest(
      first,
      page.account.id,
      "register_candidate",
      { ...payload, expected_head_revision: 1 },
      next,
    ).key,
    first.key,
  );
  assert.notEqual(
    bindingRequest(first, randomUUID(), "register_candidate", payload, next)
      .key,
    first.key,
  );
});
test("C1 read-only, demo and unselected states expose no administrative form or automatic account choice", () => {
  const page = fixture(1);
  const html = renderToStaticMarkup(
    h(ComposioAccountBindingsView, { ...props(page), allowed: false }),
  );
  assert(!html.includes(page.account.email));
  assert(!html.includes('name="auth_config_id"'));
  assert.match(html, /superadmin/);
  const unselected = renderToStaticMarkup(
    h(ComposioAccountBindings, {
      locale: "es",
      allowed: true,
      demo: false,
      accounts: [{ id: page.account.id, email: page.account.email }],
    }),
  );
  assert.match(unselected, /<option value="" selected="">/);
  assert(!unselected.includes('name="auth_config_id"'));
  const demo = renderToStaticMarkup(
    h(ComposioAccountBindings, {
      locale: "es",
      allowed: true,
      demo: true,
      accounts: [],
    }),
  );
  assert.match(demo, /Demostración/);
  assert(!demo.includes("<form"));
});
test("C1 view covers empty, loading, error, stale and 100-row history in ES/EN without activation controls", () => {
  for (const locale of ["es", "en"] as const) {
    for (const count of [0, 1, 100]) {
      const page = fixture(count);
      assert.ok(bindingPageSchema.safeParse(page).success);
      const html = renderToStaticMarkup(
        h(ComposioAccountBindingsView, { ...props(page), locale }),
      );
      assert.equal((html.match(/<article/g) || []).length, count);
      assert.match(html, /Gmail/);
      assert.match(html, /name="composio_project_id"/);
      assert.match(html, /name="auth_config_id"/);
      assert.match(html, /name="connected_account_id"/);
      assert.match(html, /name="composio_user_id"/);
      assert.match(html, /name="google_quota_project_id"/);
      assert.match(html, /aria-describedby=/);
      assert.match(html, /maxLength="1024"/i);
      assert.match(html, /data-native-protected/);
      assert(
        !/<button[^>]*>[^<]*(Activar|Activate|Enviar|Send|Verificar|Verify)/.test(
          html,
        ),
      );
      if (count === 100)
        assert.match(html, locale === "es" ? /Cargar más/ : /Load more/);
    }
    const page = fixture(1);
    page.account.ready = false;
    page.current!.stale = true;
    const stale = renderToStaticMarkup(
      h(ComposioAccountBindingsView, { ...props(page), locale }),
    );
    assert.match(stale, /<fieldset disabled=""/);
    assert.match(
      stale,
      locale === "es" ? /Revocar candidato/ : /Revoke candidate/,
    );
    assert.match(
      stale,
      locale === "es" ? /contexto cambió/ : /context changed/,
    );
    const error = renderToStaticMarkup(
      h(ComposioAccountBindingsView, {
        ...props(page),
        locale,
        error: "private provider detail",
        fresh: false,
      }),
    );
    assert.match(error, /role="alert"/);
    assert(!error.includes("private provider detail"));
    assert.match(error, /tabindex="-1"/);
    const loading = renderToStaticMarkup(
      h(ComposioAccountBindingsView, { ...props(), locale, loading: true }),
    );
    assert.match(loading, /aria-busy="true"/);
    assert.match(loading, /role="status"/);
  }
});
