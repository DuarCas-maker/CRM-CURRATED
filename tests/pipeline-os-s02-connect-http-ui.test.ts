import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ComposioConnect,
  ComposioConnectView,
} from "../src/components/composio-connect";
import {
  connectViewHttp,
  connectOptionsHttp,
  connectReturnAttempt,
} from "../src/lib/composio-connect-http";
const noop = () => {};

test("COMPAT04: failed identity return is visible and never offers another Google authorization", () => {
  for (const locale of ["es", "en"] as const) {
    const p = props(locale),
      id = randomUUID();
    const view = connectViewHttp.parse({
      status: {
        id,
        revision: 4,
        state: "awaiting_consent",
        deadline_ms: 1799999999000,
        expected_mailbox_email: "expected@fixture.test",
        account_id: p.accounts[0].id,
        brand_id: p.options.brands[0].id,
        binding_id: null,
        cleanup_required: true,
        composio_enabled: false,
        next: "resume",
        expired: false,
      },
      pending: null,
      context_changed: false,
    });
    for (const returnError of [null, "CONNECT_UNAVAILABLE"] as const) {
      const html = renderToStaticMarkup(
        h(ComposioConnectView, { ...p, attempt: id, view, returnError }),
      );
      assert.match(html, /role="alert"/);
      assert.match(
        html,
        locale === "es"
          ? /No repitas la autorización/
          : /Do not repeat Google authorization/,
      );
      assert(!html.includes(`/connect/${id}/resume`));
      assert(!html.includes("Esperando autorización en Google"));
      assert.match(
        html,
        locale === "es" ? /Revisar intento/ : /Review attempt/,
      );
    }
    const expired = renderToStaticMarkup(
      h(ComposioConnectView, {
        ...p,
        attempt: id,
        view: { ...view, status: { ...view.status!, expired: true } },
        returnError: "CONNECT_CLOSED",
      }),
    );
    assert.match(
      expired,
      locale === "es" ? /venció sin confirmar/ : /expired without confirming/,
    );
  }
});

test("COMPAT05: stale callback notice cannot block a server-verified candidate", () => {
  const p = props(),
    id = randomUUID();
  const view = connectViewHttp.parse({
    status: {
      id,
      revision: 5,
      state: "ready_to_register",
      deadline_ms: 1799999999000,
      expected_mailbox_email: "expected@fixture.test",
      account_id: p.accounts[0].id,
      brand_id: p.options.brands[0].id,
      binding_id: null,
      cleanup_required: false,
      composio_enabled: false,
      next: "register_candidate",
      expired: false,
    },
    pending: null,
    context_changed: false,
  });
  const html = renderToStaticMarkup(
    h(ComposioConnectView, {
      ...p,
      attempt: id,
      view,
      returnError: "CONNECT_UNAVAILABLE",
    }),
  );
  assert.match(html, /Registrar candidato revisado/);
  assert(!html.includes('role="alert"'));
  assert(!html.includes("CONNECT_UNAVAILABLE"));
});
function props(locale: "es" | "en" = "es") {
  const id = randomUUID();
  return {
    locale,
    accounts: [{ id, email: "long.expected.mailbox@fixture.test" }],
    options: connectOptionsHttp.parse({
      enabled: true,
      generation: 2,
      organizations: [{ id: "fixture", label: "Organización de ensayo" }],
      brands: [
        {
          id: randomUUID(),
          name: "Marca de ensayo con nombre extenso",
          revision: 1,
        },
      ],
      next_cursor: null,
      account: null,
    }),
    view: null as ReturnType<typeof connectViewHttp.parse> | null,
    attempt: "",
    draft: {
      mode: "new" as const,
      account_id: "",
      brand_id: "",
      email: "",
      organization: "",
    },
    busy: false,
    error: "",
    onDraft: noop,
    onOptions: noop,
    onMore: noop,
    onBegin: noop,
    onStatus: noop,
    onAction: noop,
    onNew: noop,
  };
}
test("HTTP UI: demo/non-admin hidden, no automatic account or provider work", () => {
  assert.equal(
    renderToStaticMarkup(
      h(ComposioConnect, {
        locale: "es",
        allowed: false,
        demo: false,
        accounts: [],
      }),
    ),
    "",
  );
  assert.equal(
    renderToStaticMarkup(
      h(ComposioConnect, {
        locale: "en",
        allowed: true,
        demo: true,
        accounts: [],
      }),
    ),
    "",
  );
  const html = renderToStaticMarkup(
    h(ComposioConnect, {
      locale: "es",
      allowed: true,
      demo: false,
      accounts: [],
    }),
  );
  assert.match(html, /Revisar disponibilidad/);
  assert(!html.includes("<form"));
  assert(!html.includes("connect.composio.dev"));
});
test("HTTP UI: ES/EN states never label consent or candidate as active transport", () => {
  for (const locale of ["es", "en"] as const) {
    const p = props(locale);
    const id = randomUUID();
    for (const state of [
      "prepared",
      "awaiting_consent",
      "awaiting_brand",
      "ready_to_register",
      "completed",
      "uncertain",
      "rejected",
    ] as const) {
      const view = connectViewHttp.parse({
        status: {
          id,
          revision: 2,
          state,
          deadline_ms: 1799999999000,
          expected_mailbox_email: "expected@fixture.test",
          account_id: p.accounts[0].id,
          brand_id: p.options.brands[0].id,
          binding_id: state === "completed" ? randomUUID() : null,
          cleanup_required: state === "uncertain",
          composio_enabled: false,
          next:
            state === "prepared"
              ? "authorize"
              : state === "awaiting_consent"
                ? "resume"
                : state === "awaiting_brand"
                  ? "review_brand"
                  : state === "ready_to_register"
                    ? "register_candidate"
                    : state === "uncertain"
                      ? "reconcile"
                      : "none",
          expired: false,
        },
        pending:
          state === "awaiting_brand"
            ? {
                review_id: randomUUID(),
                expected_revision: 2,
                context_hash: "a".repeat(64),
              }
            : null,
        context_changed: false,
      });
      const html = renderToStaticMarkup(
        h(ComposioConnectView, { ...p, attempt: id, view }),
      );
      assert(!html.includes("https://connect.composio.dev"));
      assert(!html.includes("api_key"));
      assert(!html.includes("callback_state"));
      assert(!html.includes('<input type="hidden"'));
      if (state === "awaiting_consent") {
        assert.match(html, /method="post"/);
        assert.match(
          html,
          new RegExp(`/api/mail/composio/connect/${id}/resume`),
        );
      }
      if (state === "completed")
        assert.match(
          html,
          locale === "es"
            ? /transporte sin activar/
            : /transport not activated/,
        );
      if (state === "uncertain") assert(!html.includes('resume"'));
    }
  }
});
test("HTTP UI: disabled, busy, empty and safe error states remain readable", () => {
  const p = props();
  const disabled = renderToStaticMarkup(
    h(ComposioConnectView, { ...p, options: { ...p.options, enabled: false } }),
  );
  assert.match(disabled, /no está habilitada/);
  assert(!disabled.includes("<form"));
  const html = renderToStaticMarkup(
    h(ComposioConnectView, {
      ...p,
      busy: true,
      error: "La operación requiere revisión.",
    }),
  );
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /type="email"/);
  assert.match(html, /<option value="" selected="">/);
});
test("HTTP public schemas reject tuples/secrets, unsafe revisions and duplicate return IDs", () => {
  const p = props();
  assert.equal(
    connectOptionsHttp.safeParse({ ...p.options, api_key: "secret" }).success,
    false,
  );
  assert.equal(
    connectReturnAttempt(new URLSearchParams("composio_connect=not-an-id")),
    null,
  );
});
