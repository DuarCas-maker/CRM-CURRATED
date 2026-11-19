import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  prepareLegacyMailbox,
  type LegacyAccount,
  type LegacyReview,
  type LegacyMailboxPorts,
} from "../src/lib/server/mail-accounts/onboarding/legacy-account";
import { BrandError } from "../src/lib/server/brand-actions";
import { HttpError } from "../src/lib/server/supabase";
import {
  createOnboarding,
  type OnboardingPorts,
} from "../src/lib/server/mail-accounts/onboarding/service";
import { simpleConnectionError } from "../src/lib/server/mail-accounts/onboarding/service";

function fixture() {
  const brand = { id: randomUUID() },
    input = {
      email: "legacy@example.test",
      provider: "gmail_oauth" as const,
      idempotency_key: randomUUID(),
    };
  let account: LegacyAccount | null = {
    id: randomUUID(),
    organization: "fixture",
    status: "disconnected",
    operating_brand_id: null,
    brand_revision: 0,
  };
  let review: LegacyReview | null = null;
  const calls: { kind: string; payload: any; key: string }[] = [];
  const p: LegacyMailboxPorts = {
    account: async () => account,
    brand: async () => brand,
    review: async () => review,
    command: async (kind, payload, key) => {
      calls.push({ kind, payload, key });
      if (kind === "brand_mapping_propose")
        return { id: randomUUID(), revision: 1, status: "pending" };
      account = {
        ...account!,
        operating_brand_id: brand.id,
        brand_revision: account!.brand_revision + 1,
      };
      return {
        id: (payload as any).review_id,
        revision: 2,
        status: "confirmed",
      };
    },
  };
  return {
    p,
    input,
    brand,
    calls,
    setAccount: (a: LegacyAccount | null) => {
      account = a;
    },
    account: () => account!,
    setReview: (r: Partial<LegacyReview>) => {
      review = {
        id: randomUUID(),
        revision: 1,
        status: "pending",
        proposed_brand_id: brand.id,
        expected_account_revision: 0,
        evidence_reference: "prior-reviewed-reference",
        history_approved: false,
        history_from: null,
        history_to: null,
        ...r,
      };
    },
  };
}
test("Legacy unbranded row uses audited proposal/confirmation, preserves identity and is replay safe", async () => {
  const f = fixture(),
    id = f.account().id;
  await prepareLegacyMailbox(f.p, f.input, "fixture");
  assert.deepEqual(
    f.calls.map((c) => c.kind),
    ["brand_mapping_propose", "brand_mapping_confirm"],
  );
  assert.equal(f.account().id, id);
  assert.equal(f.account().status, "disconnected");
  assert.equal(f.calls[0].payload.history_approved, false);
  assert.equal(f.calls[1].payload.acknowledge_conflict, false);
  assert.equal(f.calls[1].payload.expected_account_revision, 0);
  await prepareLegacyMailbox(f.p, f.input, "fixture");
  assert.equal(f.calls.length, 2);
});
test("Compatible pending review is confirmed without replacing its evidence", async () => {
  const f = fixture();
  f.setReview({});
  await prepareLegacyMailbox(f.p, f.input, "fixture");
  assert.deepEqual(
    f.calls.map((c) => c.kind),
    ["brand_mapping_confirm"],
  );
});
test("New and already branded accounts are left to the normal onboarding contract", async () => {
  for (const mode of ["new", "branded"]) {
    const f = fixture();
    f.setAccount(
      mode === "new"
        ? null
        : { ...f.account(), operating_brand_id: f.brand.id },
    );
    await prepareLegacyMailbox(f.p, f.input, "fixture");
    assert.equal(f.calls.length, 0);
  }
});
test("Different workspace, connected account, conflicting/stale/historical reviews never auto-confirm", async () => {
  for (const change of [
    "workspace",
    "connected",
    "other-brand",
    "conflict",
    "stale",
    "history",
    "history-range",
  ]) {
    const f = fixture();
    if (change === "workspace")
      f.setAccount({ ...f.account(), organization: "foreign" });
    else if (change === "connected")
      f.setAccount({ ...f.account(), status: "connected" });
    else
      f.setReview(
        change === "other-brand"
          ? { proposed_brand_id: randomUUID() }
          : change === "conflict"
            ? { status: "conflict" }
            : change === "stale"
              ? { expected_account_revision: 1 }
              : change === "history"
                ? { history_approved: true }
                : {
                    history_from: "2026-01-01T00:00:00Z",
                    history_to: "2026-02-01T00:00:00Z",
                  },
      );
    await assert.rejects(
      prepareLegacyMailbox(f.p, f.input, "fixture"),
      /SIMPLE_LEGACY_REVIEW_REQUIRED/,
    );
    assert.equal(f.calls.length, 0, change);
  }
});
test("Proposal conflict and concurrent DB revision guards stop confirmation; MFA denial stays forbidden", async () => {
  const f = fixture();
  f.p.command = async (kind, payload, key) => {
    f.calls.push({ kind, payload, key });
    return { id: randomUUID(), revision: 1, status: "conflict" };
  };
  await assert.rejects(
    prepareLegacyMailbox(f.p, f.input, "fixture"),
    /SIMPLE_LEGACY_REVIEW_REQUIRED/,
  );
  assert.equal(f.calls.length, 1);
  for (const code of [
    "BRAND_REVIEW_STALE",
    "BRAND_FORBIDDEN",
    "BRAND_UNAVAILABLE",
  ] as const) {
    const g = fixture();
    g.setReview({});
    g.p.command = async () => {
      throw new BrandError(code, 409);
    };
    await assert.rejects(
      prepareLegacyMailbox(g.p, g.input, "fixture"),
      code === "BRAND_FORBIDDEN"
        ? /SIMPLE_FORBIDDEN/
        : code === "BRAND_UNAVAILABLE"
          ? /SIMPLE_UNAVAILABLE/
          : /SIMPLE_LEGACY_REVIEW_REQUIRED/,
    );
  }
});
test("Unknown errors do not promise a saved attempt; legacy conflict explains where to review", async () => {
  const r = simpleConnectionError(new HttpError(503, "SIMPLE_UNAVAILABLE"));
  const v = await r.json();
  assert.equal(r.status, 503);
  assert.doesNotMatch(v.error, /retomar/i);
  assert.match(v.error, /Inténtalo de nuevo/);
  const blocked = await simpleConnectionError(
    new HttpError(409, "SIMPLE_LEGACY_REVIEW_REQUIRED"),
  ).json();
  assert.match(blocked.error, /Configuración.*Marcas/);
  assert.match(blocked.error, /No se ha iniciado/);
});
test("Human MFA/options and active advisor validation precede every legacy write", async () => {
  const f = fixture(),
    events: string[] = [];
  const input = { ...f.input, advisor_id: randomUUID() };
  const ports = {
    workspace: () => ({ id: "fixture", domain: "example.test" }),
    state: () => "fictional-state",
    human: {
      rpc: async (name: string) => {
        events.push(name);
        return {
          data: {
            enabled: true,
            advisors: [
              {
                id: input.advisor_id,
                name: "Fixture",
                email: "owner@example.test",
              },
            ],
            connections: [],
          },
          error: null,
        };
      },
    },
    prepareDirect: async () => {
      events.push("prepare");
      throw Error("PREPARE_STOP");
    },
  } as unknown as OnboardingPorts;
  await assert.rejects(createOnboarding(ports).begin(input), /PREPARE_STOP/);
  assert.deepEqual(events, ["simple_mail_options", "prepare"]);
  events.length = 0;
  await assert.rejects(
    createOnboarding(ports).begin({ ...input, advisor_id: randomUUID() }),
    /SIMPLE_ADVISOR_REQUIRED/,
  );
  assert.deepEqual(events, ["simple_mail_options"]);
  events.length = 0;
  ports.human = {
    rpc: async () => ({ data: null, error: { message: "SIMPLE_FORBIDDEN" } }),
  } as any;
  await assert.rejects(
    createOnboarding(ports).begin(input),
    /SIMPLE_FORBIDDEN/,
  );
  assert.deepEqual(events, []);
});
