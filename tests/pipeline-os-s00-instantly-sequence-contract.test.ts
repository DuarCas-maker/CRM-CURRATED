import test from "node:test";
import assert from "node:assert/strict";
import {
  instantlyB,
  bCampaignPayload,
  runInstantlyB,
  assertBTransition,
  validateBState,
  type BState,
} from "../scripts/pipeline-os/s00-instantly-b";
import {
  runInstantlyBRecovery,
  assertBRTransition,
  validateBRState,
  type BRState,
} from "../scripts/pipeline-os/s00-instantly-b-recovery";
import { configuredCampaignProjection } from "../scripts/pipeline-os/s00-instantly-config-diagnostic";
import type { InstantlyRecovery } from "../scripts/pipeline-os/s00-instantly-recovery";
import type { BDState } from "../scripts/pipeline-os/s00-instantly-b-diagnostic";
import {
  bSourceFixture,
  bManifest,
  bWorkspace,
  bId,
  bEnv,
  bJson,
  BClock,
  BProvider,
} from "./fixtures/pipeline-os-instantly-b";
import { brSourceFixture } from "./fixtures/pipeline-os-instantly-b-recovery";
import { cfdSourceFixture } from "./fixtures/pipeline-os-instantly-config-diagnostic";

globalThis.fetch = async () => {
  throw Error("REAL_NETWORK_FORBIDDEN");
};

async function scenario() {
  const f = await bSourceFixture(),
    manifest = bManifest();
  const ctx = {
    prior: f.prior,
    campaignId: bId(700),
    leads: { A: null, B: null },
  };
  const body = {
    ...bCampaignPayload(ctx, manifest, true),
    id: ctx.campaignId,
    organization: bWorkspace,
    status: 2,
  };
  return { ctx, manifest, body };
}

test("SC-AC01 documented days defaults pass the configured non-sending trial without mutation", async () => {
  const f = await scenario();
  for (const extra of [
    {},
    { delay_unit: "days" },
    { pre_delay_unit: "days" },
    { delay_unit: "days", pre_delay_unit: "days" },
  ]) {
    const body = structuredClone(f.body);
    Object.assign(body.sequences[0].steps[0], extra);
    const before = structuredClone(body),
      expectedBefore = structuredClone(f.manifest);
    assert.doesNotThrow(() =>
      instantlyB.assertCampaign(
        f.ctx,
        f.manifest,
        body,
        bWorkspace,
        true,
        true,
      ),
    );
    assert.deepEqual(body, before);
    assert.deepEqual(f.manifest, expectedBefore);
  }
});

test("SC-AC02 other units, null, undefined and nonstrings fail without coercion", async () => {
  const f = await scenario();
  for (const key of ["delay_unit", "pre_delay_unit"]) {
    for (const value of [
      null,
      undefined,
      false,
      0,
      [],
      {},
      "minutes",
      "hours",
      "weeks",
      "DAYS",
      " days",
      "days ",
      "private-unit-sentinel",
    ]) {
      const body = structuredClone(f.body);
      Object.assign(body.sequences[0].steps[0], { [key]: value });
      assert.throws(
        () =>
          instantlyB.assertCampaign(
            f.ctx,
            f.manifest,
            body,
            bWorkspace,
            true,
            true,
          ),
        { message: "B_UNSAFE_CAMPAIGN" },
      );
    }
  }
});

test("SC-AC02 unknown fields and zero pre-delay cannot be stripped as defaults", async () => {
  const f = await scenario();
  for (const extra of [
    { pre_delay: 0 },
    { pre_delay: 2 },
    { v_disabled: false },
    { other: "private-sentinel" },
    { variants: [] },
    { type: "sms" },
    { delay: 1 },
    { delay: "0" },
  ]) {
    const body = structuredClone(f.body);
    Object.assign(body.sequences[0].steps[0], {
      delay_unit: "days",
      pre_delay_unit: "days",
      ...extra,
    });
    assert.throws(
      () =>
        instantlyB.assertCampaign(
          f.ctx,
          f.manifest,
          body,
          bWorkspace,
          true,
          true,
        ),
      { message: "B_UNSAFE_CAMPAIGN" },
    );
  }
});

test("SC-AC02 inherited fields and altered sequence cardinality stay blocked", async () => {
  const f = await scenario();
  const changes: ((body: any) => void)[] = [
    (body) =>
      Object.setPrototypeOf(body.sequences[0].steps[0], { delay_unit: "days" }),
    (body) => {
      const sequence = body.sequences[0];
      body.sequences[0] = Object.create(sequence);
    },
    (body) => {
      const step = body.sequences[0].steps[0];
      body.sequences[0].steps[0] = Object.create(step);
    },
    (body) => {
      const step = body.sequences[0].steps[0];
      step.variants[0] = Object.create(step.variants[0]);
    },
    (body) => body.sequences.push(structuredClone(body.sequences[0])),
    (body) =>
      body.sequences[0].steps.push(structuredClone(body.sequences[0].steps[0])),
    (body) =>
      body.sequences[0].steps[0].variants.push(
        structuredClone(body.sequences[0].steps[0].variants[0]),
      ),
    (body) => {
      body.sequences[0].extra = true;
    },
    (body) => {
      body.sequences = [];
    },
    (body) => {
      body.sequences = null;
    },
    (body) => {
      delete body.sequences;
    },
  ];
  for (const change of changes) {
    const body = structuredClone(f.body);
    change(body);
    assert.throws(
      () =>
        instantlyB.assertCampaign(
          f.ctx,
          f.manifest,
          body,
          bWorkspace,
          true,
          true,
        ),
      { message: "B_UNSAFE_CAMPAIGN" },
    );
  }
});

test("SC-AC02 compatible units cannot weaken identity, status, routing, flags, schedule or copy", async () => {
  const f = await scenario();
  const changes: ((body: any) => void)[] = [
    (b) => {
      b.id = bId(999);
    },
    (b) => {
      b.organization = bId(999);
    },
    (b) => {
      b.name = "foreign";
    },
    (b) => {
      b.status = 1;
    },
    (b) => {
      b.status = 0;
    },
    (b) => {
      b.stop_on_reply = false;
    },
    (b) => {
      b.is_evergreen = true;
    },
    (b) => {
      b.stop_for_company = true;
    },
    (b) => {
      b.ai_sdr_id = bId(999);
    },
    (b) => {
      b.campaign_schedule.schedules[0].timezone = "UTC";
    },
    (b) => {
      b.sequences[0].steps[0].variants[0].subject += " changed";
    },
    (b) => {
      b.sequences[0].steps[0].variants[0].body += " changed";
    },
    ...[
      "email_list",
      "email_tag_list",
      "cc_list",
      "bcc_list",
      "provider_routing_rules",
    ].map((k) => (b: any) => {
      b[k] = ["foreign"];
    }),
  ];
  for (const change of changes) {
    const body = structuredClone(f.body);
    Object.assign(body.sequences[0].steps[0], {
      delay_unit: "days",
      pre_delay_unit: "days",
    });
    change(body);
    assert.throws(() =>
      instantlyB.assertCampaign(
        f.ctx,
        f.manifest,
        body,
        bWorkspace,
        true,
        true,
      ),
    );
  }
});

test("SC-AC03 payload stays unchanged and request_exact opts out of compatibility", async () => {
  const f = await scenario(),
    payload = bCampaignPayload(f.ctx, f.manifest, true);
  assert.deepEqual(payload.sequences, [
    {
      steps: [
        {
          type: "email",
          delay: 0,
          variants: [{ subject: f.manifest.subject, body: f.manifest.body }],
        },
      ],
    },
  ]);
  const initial = {
    ...bCampaignPayload(f.ctx, f.manifest, false),
    id: f.ctx.campaignId,
    organization: bWorkspace,
    status: 2,
  };
  assert.deepEqual(initial.sequences, []);
  assert.doesNotThrow(() =>
    instantlyB.assertCampaign(
      f.ctx,
      f.manifest,
      initial,
      bWorkspace,
      false,
      true,
    ),
  );
  Object.assign(f.body.sequences[0].steps[0], {
    delay_unit: "days",
    pre_delay_unit: "days",
  });
  assert.throws(
    () =>
      instantlyB.assertCampaign(
        f.ctx,
        f.manifest,
        f.body,
        bWorkspace,
        true,
        true,
        "request_exact",
      ),
    { message: "B_UNSAFE_CAMPAIGN" },
  );
  assert.doesNotThrow(() =>
    instantlyB.assertCampaign(
      f.ctx,
      f.manifest,
      f.body,
      bWorkspace,
      true,
      true,
    ),
  );
  assert.throws(
    () =>
      instantlyB.assertCampaign(
        f.ctx,
        f.manifest,
        f.body,
        bWorkspace,
        false,
        true,
      ),
    { message: "B_UNSAFE_CAMPAIGN" },
  );
});

test("SC-AC03 CFD raw mismatch stays false when corrected trial guard accepts days", async () => {
  const f = await cfdSourceFixture(),
    before = structuredClone(f.inputs.source);
  Object.assign(f.body.sequences[0].steps[0], {
    delay_unit: "days",
    pre_delay_unit: "days",
  });
  const ctx = {
    prior: f.inputs.source.prior.prior.prior,
    campaignId: f.inputs.source.prior.prior.campaignId,
    leads: f.inputs.source.leads,
  };
  assert.doesNotThrow(() =>
    instantlyB.assertCampaign(
      ctx,
      f.inputs.manifest,
      f.body,
      bWorkspace,
      true,
      true,
    ),
  );
  const p = configuredCampaignProjection(
    f.inputs.source,
    f.inputs.manifest,
    bWorkspace,
    f.body,
  );
  assert.equal(p.configuredGuardPassesNow, false);
  assert.equal(p.historicalFailureCauseProven, false);
  assert.equal(p.sendingSafetyCertified, false);
  for (const key of ["delay_unit", "pre_delay_unit"])
    assert.equal(
      p.fields.find((r) => r.path === `sequences[0].steps[0].${key}`)?.reason,
      "unexpected",
    );
  assert.equal(
    p.fields.find((r) => r.path === "sequences")?.reason,
    "mismatch",
  );
  assert.deepEqual(f.inputs.source, before);
});

test("SC-AC04 B fixture completes with defaults at configured/final checkpoints", async () => {
  const inputs = await bSourceFixture(),
    provider = new BProvider();
  let value: InstantlyRecovery | BState = inputs.prior;
  const methods: string[] = [];
  const r = await runInstantlyB(
    bEnv,
    {
      load: async () => structuredClone(value),
      save: async (s) => {
        assertBTransition(value, s);
        value = structuredClone(s);
      },
    },
    inputs,
    {
      execute: true,
      authorizedNew: 25,
      authorizedTotal: 36,
      includedCallsConfirmed: true,
      manifestReviewed: true,
      clock: new BClock(),
      fetchImpl: async (raw, init) => {
        methods.push(String(init?.method));
        const result = provider.handle(String(raw), init!);
        const step = provider.campaign?.sequences[0]?.steps[0];
        if (step)
          Object.assign(step, { delay_unit: "days", pre_delay_unit: "days" });
        return bJson(result);
      },
    },
  );
  assert.equal(r.status, "completed");
  assert.equal(r.calls, 30);
  assert.equal(r.newCalls, 19);
  assert.equal(r.sendingSafetyCertified, false);
  assert.equal(methods.length, 19);
  assert.deepEqual(validateBState(value).prior, inputs.prior);
});

for (const uncertain of [false, true])
  test(`SC-AC04 BR defaults with uncertain configure=${uncertain} never repeat PATCH`, async () => {
    const f = await brSourceFixture();
    let value: BDState | BRState = f.inputs.source,
      configures = 0;
    const source = structuredClone(f.inputs.source);
    const r = await runInstantlyBRecovery(
      bEnv,
      {
        load: async () => structuredClone(value),
        save: async (s) => {
          assertBRTransition(value, s);
          value = structuredClone(s);
        },
      },
      f.inputs,
      {
        execute: true,
        authorizedNew: 22,
        authorizedTotal: 41,
        includedCallsConfirmed: true,
        manifestReviewed: true,
        clock: new BClock(),
        fetchImpl: async (raw, init) => {
          const result = f.provider.handle(String(raw), init!);
          const step = f.provider.campaign?.sequences[0]?.steps[0];
          if (step)
            Object.assign(step, { delay_unit: "days", pre_delay_unit: "days" });
          if (
            init?.method === "PATCH" &&
            new URL(String(raw)).pathname.includes("/campaigns/")
          ) {
            configures++;
            if (uncertain) throw Error("FICTIONAL_LOST_RESPONSE");
          }
          return bJson(result);
        },
      },
    );
    assert.equal(r.status, "completed");
    assert.equal(configures, 1);
    assert.ok(r.calls <= 41);
    assert.equal(r.sendingSafetyCertified, false);
    assert.deepEqual(validateBRState(value).prior, source);
  });
