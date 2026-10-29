import { hash } from "../../scripts/pipeline-os/s00-composio-common";
import {
  assertInstantlyTransition,
  runInstantlyPhaseA,
  type InstantlyState,
  type InstantlyClock,
} from "../../scripts/pipeline-os/s00-instantly-runner";
import {
  recoverInstantlyPagination,
  assertInstantlyRecoveryTransition,
  type InstantlyLedger,
  type InstantlyRecovery,
  validateInstantlyRecovery,
} from "../../scripts/pipeline-os/s00-instantly-recovery";
import {
  validateBManifest,
  type BManifest,
  type BState,
} from "../../scripts/pipeline-os/s00-instantly-b";

export const bSecret = "B_FICTIONAL_PRIVATE_SENTINEL",
  bWorkspace = "00000000-0000-4000-8000-000000000001",
  bOther = "00000000-0000-4000-8000-000000000002";
export const bEnv = {
  INSTANTLY_API_KEY: bSecret,
  INSTANTLY_WORKSPACE_ID: bWorkspace,
};
export const bId = (n: number) =>
  "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const bJson = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
export class BClock implements InstantlyClock {
  time = 0;
  waits: number[] = [];
  now = () => this.time;
  async sleep(ms: number, signal?: AbortSignal) {
    if (signal?.aborted) throw Error(bSecret);
    this.waits.push(ms);
    this.time += ms;
  }
}
export function bManifest(): BManifest {
  return validateBManifest({
    version: 1,
    controlledRecipientsConfirmed: true,
    exclusiveTrialControlConfirmed: true,
    recipients: ["b-a@example.invalid", "b-b@example.invalid"],
    schedule: {
      schedules: [
        {
          name: "Fictional",
          timing: { from: "09:00", to: "09:05" },
          days: {
            0: false,
            1: true,
            2: false,
            3: false,
            4: false,
            5: false,
            6: false,
          },
          timezone: "America/Bogota",
        },
      ],
      start_date: "2026-11-02",
      end_date: "2026-11-02",
    },
    subject: "Fictional S00",
    body: "Fixture draft, never send",
    statusMapping: {
      confirmed: true,
      source: "operator_panel",
      evidenceRef: "fictional-status-evidence",
      draftStatus: 0,
      pausedStatus: 2,
    },
  });
}
// Produce v2/11 through the actual A/R implementations and injected clocks/transports.
export async function bSourceFixture() {
  let v1: InstantlyState | undefined;
  await runInstantlyPhaseA(
    bEnv,
    {
      load: async () => v1,
      save: async (s) => {
        assertInstantlyTransition(v1, s);
        v1 = structuredClone(s);
      },
    },
    {
      execute: true,
      phase: "A",
      authorizedNew: 12,
      includedCallsConfirmed: true,
      clock: new BClock(),
      fetchImpl: async (raw) => {
        const path = new URL(String(raw)).pathname;
        if (path.endsWith("/current")) return bJson({ id: bWorkspace });
        if (path.endsWith("/plan-details"))
          return bJson({
            organization_id: bWorkspace,
            subscriptions: {
              outreach: { total_lead_limit: 25000, current_lead_count: 24917 },
            },
          });
        return bJson({
          items: [
            {
              id: bId(9),
              organization_id: bWorkspace,
              key: "OTHER_PRIVATE_KEY",
              scopes: ["all:all"],
            },
          ],
          next_starting_after: bId(9),
        });
      },
    },
  );
  let value: InstantlyLedger = v1!;
  await recoverInstantlyPagination(
    bEnv,
    {
      load: async () => value,
      save: async (s) => {
        if (s.version !== 2) throw Error("BAD_VERSION");
        assertInstantlyRecoveryTransition(value, s);
        value = structuredClone(s);
      },
    },
    {
      execute: true,
      phase: "A",
      authorizedNew: 8,
      authorizedTotal: 12,
      includedCallsConfirmed: true,
      clock: new BClock(),
      fetchImpl: async (raw) => {
        const u = new URL(String(raw)),
          p = u.pathname;
        if (p.endsWith("/current")) return bJson({ id: bWorkspace });
        if (p.endsWith("/plan-details"))
          return bJson({
            organization_id: bWorkspace,
            subscriptions: {
              outreach: { total_lead_limit: 25000, current_lead_count: 24917 },
            },
          });
        if (p.endsWith("/api-keys"))
          return bJson({ items: [], next_starting_after: bId(9) });
        if (p.endsWith("/accounts"))
          return bJson({
            items: [
              {
                organization: bWorkspace,
                email: u.searchParams.has("starting_after")
                  ? "second@example.invalid"
                  : "first@example.invalid",
                status: 1,
                daily_limit: 30,
              },
            ],
            ...(u.searchParams.has("starting_after")
              ? {}
              : { next_starting_after: "second" }),
          });
        if (p.endsWith("/event-types"))
          return bJson({
            event_types: [
              "reply_received",
              "email_bounced",
              "lead_unsubscribed",
            ].map((id) => ({ id })),
          });
        return bJson({ items: [] });
      },
    },
  );
  const prior = validateInstantlyRecovery(value);
  if (prior.calls !== 11) throw Error("BAD_SOURCE");
  const scope = {
    version: 1,
    provider: "instantly",
    phase: "A",
    kind: "operator_scope_attestation",
    recordedAt: "2026-10-26T12:00:00Z",
    keyLabel: "CRM-curated",
    declaredScopes: ["all:all"],
    evidence: {
      panel: "fixture",
      screenshotName: "fixture.png",
      screenshotSha256: "a".repeat(64),
      userConfirmedSavedKeyLabel: true,
    },
    binding: {
      basis: "last_tested_configuration_and_user_confirmation",
      configurationFingerprint: prior.predecessor.fingerprint,
      ledgerManifestHash: prior.manifestHash,
      ledgerSha256: hash(JSON.stringify(prior, null, 2) + "\n"),
      priorCalls: 4,
      accumulatedCalls: 11,
    },
    apiListingMatchedCurrentKey: false,
    effectiveWritesTested: false,
    authorizesRemoteOperations: false,
    requiresCurrentFingerprintMatchBeforeUse: true,
  };
  return { prior, scope, manifest: bManifest() };
}
type Obj = Record<string, any>;
export class BProvider {
  campaign?: Obj;
  leads: Obj[] = [];
  threePages = false;
  handle(raw: string, init: RequestInit): Obj {
    const u = new URL(raw),
      p = u.pathname,
      method = init.method,
      body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (u.origin !== "https://api.instantly.ai") throw Error("BAD_HOST");
    if (method === "GET" && p.endsWith("/current")) return { id: bWorkspace };
    if (method === "GET" && p.endsWith("/plan-details"))
      return {
        organization_id: bWorkspace,
        subscriptions: {
          outreach: { total_lead_limit: 25000, current_lead_count: 24917 },
        },
      };
    if (method === "GET" && p === "/api/v2/campaigns")
      return { items: this.campaign ? [structuredClone(this.campaign)] : [] };
    if (method === "POST" && p === "/api/v2/campaigns") {
      this.campaign = {
        ...structuredClone(body),
        id: bId(30),
        organization: bWorkspace,
        status: 0,
      };
      return structuredClone(this.campaign!);
    }
    if (method === "POST" && p === `/api/v2/campaigns/${bId(30)}/pause`) {
      this.campaign!.status = 2;
      return structuredClone(this.campaign!);
    }
    if (method === "PATCH" && p === `/api/v2/campaigns/${bId(30)}`) {
      Object.assign(this.campaign!, structuredClone(body));
      return structuredClone(this.campaign!);
    }
    if (method === "GET" && p === `/api/v2/campaigns/${bId(30)}`)
      return structuredClone(this.campaign!);
    if (method === "POST" && p === "/api/v2/leads") {
      if (
        body.verify_leads_on_import !== false ||
        body.verify_leads_for_lead_finder !== false ||
        body.skip_if_in_workspace !== true ||
        body.skip_if_in_campaign !== true
      )
        throw Error("PAID_OR_DUPLICATE_GUARD");
      const lead = {
        id: bId(body.custom_variables.s00_alias === "A" ? 40 : 41),
        organization: bWorkspace,
        campaign: body.campaign,
        email: body.email,
        status: 1,
        payload: structuredClone(body.custom_variables),
      };
      this.leads.push(lead);
      return structuredClone(lead);
    }
    if (method === "POST" && p === "/api/v2/leads/list") {
      if (body.contacts)
        return {
          items: this.leads
            .filter((l) => body.contacts.includes(l.email))
            .map((l) => structuredClone(l)),
        };
      const index = body.starting_after
          ? this.leads.findIndex((l) => l.id === body.starting_after) + 1
          : 0,
        lead = this.leads[index];
      return {
        items: lead ? [structuredClone(lead)] : [],
        ...(lead && (index === 0 || this.threePages)
          ? { next_starting_after: lead.id }
          : {}),
      };
    }
    const lead = this.leads.find((l) => p === `/api/v2/leads/${l.id}`);
    if (method === "PATCH" && lead) {
      Object.assign(lead.payload, body.custom_variables);
      return structuredClone(lead);
    }
    if (method === "GET" && lead) return structuredClone(lead);
    throw Error("UNEXPECTED_FIXTURE_ROUTE");
  }
}
export function bPublicSafe(value: unknown) {
  const t = JSON.stringify(value);
  return ![
    bSecret,
    bWorkspace,
    "b-a@example.invalid",
    "b-b@example.invalid",
    "fingerprint",
    "manifestHash",
    "campaignId",
  ].some((x) => t.includes(x));
}
