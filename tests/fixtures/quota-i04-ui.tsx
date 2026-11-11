// Standalone local visual fixture: no server/env imports, real accounts or provider calls.
import React from "react";
import { createRoot } from "react-dom/client";
import { ComposioAccountBindingsV2 } from "../../src/components/composio-account-bindings-v2";
const account = "11111111-1111-4111-8111-111111111111",
  binding = "22222222-2222-4222-8222-222222222222";
const params = new URLSearchParams(location.search),
  locale = params.get("lang") === "en" ? "en" : "es";
if (["360", "768", "1280"].includes(params.get("width") ?? "")) {
  document.querySelector("main")!.style.width = params.get("width") + "px";
  document.querySelector("main")!.style.maxWidth = "100%";
}
let head = 1,
  status = "candidate",
  check: string | null = null,
  confirmed = false,
  validUntil: string | null = null,
  postCount = 0;
const row = () => ({
  id: binding,
  revision: head,
  status,
  reason: null,
  stale: false,
  created_at: new Date().toISOString(),
  reviewed_at: null,
  external_refs: {
    project: "…ture",
    auth_config: "…ture",
    connection: "…ture",
    user: "…wner",
    quota: "…",
  },
});
window.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith("/api/mail/accounts/" + account + "/composio"))
    throw Error("FIXTURE_NETWORK_BLOCKED");
  if (!init?.method || init.method === "GET")
    return Response.json({
      contract_version: 2,
      account: {
        id: account,
        email: "pilot@example.test",
        brand_id: "33333333-3333-4333-8333-333333333333",
        brand_name: "Marca ficticia",
        brand_revision: 1,
        account_revision: 1,
        context_hash: "a".repeat(64),
        ready: true,
      },
      head_revision: head,
      transport: "gmail_oauth",
      composio_enabled: false,
      verification_available:
        !confirmed && params.get("scenario") !== "unavailable",
      can_confirm: check !== null && !confirmed,
      current: row(),
      history: [row()],
      cursor: null,
      policy: {
        id: "44444444-4444-4444-8444-444444444444",
        generation: 1,
        enabled: true,
      },
      latest_check: check
        ? { id: check, status: "completed", valid_until: validUntil }
        : null,
    });
  postCount++;
  document.getElementById("audit")!.textContent =
    `POST ficticios: ${postCount}; llamadas reales: 0`;
  await new Promise((r) => setTimeout(r, 350));
  if (params.get("scenario") === "error")
    return Response.json({ code: "C_BINDING_STALE" }, { status: 409 });
  if (url.endsWith("/check")) {
    check = "55555555-5555-4555-8555-555555555555";
    validUntil = new Date(Date.now() + 30000).toISOString();
    return Response.json({
      contract_version: 2,
      id: check,
      status: "completed",
      replay: false,
      valid_until: validUntil,
    });
  }
  const body = JSON.parse(String(init?.body));
  head++;
  if (body.kind === "confirm_binding") {
    status = "verified";
    confirmed = true;
  }
  if (body.kind === "revoke_binding") {
    status = "revoked";
    confirmed = true;
  }
  if (body.kind === "register_candidate") {
    status = "candidate";
    confirmed = false;
    check = null;
  }
  return Response.json({
    contract_version: 2,
    id: binding,
    head_revision: head,
    status,
    transport: "gmail_oauth",
    composio_enabled: false,
  });
};
createRoot(document.getElementById("root")!).render(
  <ComposioAccountBindingsV2
    locale={locale}
    allowed={true}
    demo={false}
    accounts={[{ id: account, email: "pilot@example.test" }]}
  />,
);
