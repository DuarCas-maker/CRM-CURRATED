import assert from "node:assert/strict";
import {
  composioConfiguration,
  hash,
} from "../../scripts/pipeline-os/s00-composio-common";
import { type RunState } from "../../scripts/pipeline-os/s00-composio-runner";
import { type ObservationState } from "../../scripts/pipeline-os/s00-composio-observer";
import {
  runComposioReconnect,
  type ReconnectState,
  type ReconnectSources,
  type ReconnectStore,
  type ReconnectOptions,
  type ReconnectAction,
} from "../../scripts/pipeline-os/s00-composio-reconnect";
export const base = Date.UTC(2026, 9, 26, 18),
  secret = "reconnect-private-sentinel";
export const env = {
  COMPOSIO_API_KEY: secret,
  COMPOSIO_AUTH_CONFIG_ID: "ac_test",
  COMPOSIO_CONNECTED_ACCOUNT_1_ID: "ca_one",
  COMPOSIO_CONNECTED_ACCOUNT_2_ID: "ca_two",
  S00_TEST_RECIPIENT_EMAIL: "recipient@fictional.test",
};
export const addresses = ["one@fictional.test", "two@fictional.test"],
  threads = ["111aaa", "222bbb"];
export const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
export function sourceFixture(): ReconnectSources {
  const c = composioConfiguration({
      ...env,
      COMPOSIO_API_KEY: "older-readonly-key",
    }),
    a = [
      { bytes: 5, sha256: hash("%PDF-") },
      { bytes: 6, sha256: hash("%PDF-x") },
    ];
  const run: RunState = {
    version: 1,
    phase: "prepared",
    fingerprint: c.fingerprint,
    targetFingerprint: c.targetFingerprint,
    token: "aabbcc001122",
    calls: 33,
    priorDiagnosticCalls: 4,
    profilesVerified: true,
    includedCallsConfirmed: true,
    attachmentPolicy: "provided_pdfs_10mb",
    boxes: ([1, 2] as const).map((alias, i) => ({
      alias,
      owner: "shared-owner",
      addressHash: hash(addresses[i]),
      polls: 3,
      initial: { status: "sent", id: "aa" + i, threadId: threads[i] },
      confirmation: { status: "sent", id: "bb" + i, threadId: threads[i] },
      confirmationVerified: true,
      response: {
        id: "cc" + i,
        verification: "provided_pdfs",
        attachments: a,
        attachmentHash: hash(JSON.stringify(a)),
        receivedAt: base - 5000,
        detectedAt: new Date(base - 4000).toISOString(),
      },
    })),
  };
  const observation: ObservationState = {
    version: 1,
    sourceHash: hash(JSON.stringify(run)),
    fingerprint: c.fingerprint,
    historicalCalls: 37,
    calls: 23,
    authorizedTotal: 77,
    retries: 0,
    phase: "completed",
    armedAt: base - 3000,
    ready: true,
    clock: { synchronized: true, uncertaintyMs: 802 },
    cadenceHealthy: true,
    rounds: 6,
    boxes: ([1, 2] as const).map((alias, i) => ({
      alias,
      baseline: ["aa" + i, "bb" + i, "cc" + i],
      polls: 6,
      rechecked: true,
      event: {
        id: "dd" + i,
        receivedAt: base - 2000,
        requestStartedAt: base - 1500,
        httpReceivedAt: base - 1000,
        detectedAt: base - 900,
        persistedAt: base - 800,
      },
    })),
    requests: Array.from({ length: 23 }, () => ({
      op: "poll" as const,
      alias: 1 as const,
      startedAt: base - 1200,
      httpReceivedAt: base - 1000,
      result: "OK",
    })),
  };
  return { run, observation };
}
export class Memory implements ReconnectStore {
  value?: ReconnectState;
  writes = 0;
  hook?: (s: ReconnectState) => void;
  async load() {
    return this.value ? structuredClone(this.value) : undefined;
  }
  async save(s: ReconnectState) {
    this.hook?.(s);
    this.value = structuredClone(s);
    this.writes++;
  }
}
export class Clock {
  now = 0;
  waits: number[] = [];
  wallNow = () => base + this.now;
  monoNow = () => this.now;
  async sleep(ms: number, signal?: AbortSignal) {
    if (signal?.aborted) throw Error(secret);
    this.waits.push(ms);
    this.now += ms;
  }
}
export function harness() {
  const sources = sourceFixture(),
    store = new Memory(),
    clock = new Clock(),
    calls: { op: string; body: any; method: string; path: string }[] = [];
  const h = {
    sources,
    store,
    clock,
    calls,
    revoked: false,
    linkCount: 0,
    oauth: false,
    wrongIdentity: false,
    shortLink: false,
    revocationEffective: true,
    statuses: [] as string[],
    fault: undefined as
      undefined | ((op: string, n: number) => Error | Response | undefined),
    alter: undefined as undefined | ((data: any, op: string) => void),
    fetchImpl: undefined as unknown as typeof fetch,
    run: (
      action: ReconnectAction = "prepare",
      options: ReconnectOptions = {},
    ) =>
      runComposioReconnect(env, sources, store, action, {
        execute: true,
        authorizedTotal: 88,
        managementAuthorized: true,
        includedCallsConfirmed: true,
        gates: {
          managementPermission: true,
          operatorReady: true,
          grantIsolated: true,
          noVerifier: true,
        },
        clock,
        fetchImpl: h.fetchImpl,
        ...options,
      }),
    async prepare() {
      const r = await h.run();
      assert.equal(r.phase, "prepared");
      return r;
    },
    async revoke() {
      await h.prepare();
      const r = await h.run("revoke");
      assert.equal(r.phase, "await_auth");
      return r;
    },
    async complete() {
      await h.revoke();
      h.oauth = true;
      return h.run("verify", { oauthCompleted: true });
    },
  };
  function metadata(i: number) {
    return {
      id: threads[i],
      messages: ["aa", "cc", "bb", "dd"].map((prefix) => ({
        id: prefix + i,
        threadId: threads[i],
        internalDate: String(base - 5000),
        payload: {
          headers: [
            {
              name: "From",
              value: ["cc", "dd"].includes(prefix)
                ? env.S00_TEST_RECIPIENT_EMAIL
                : addresses[i],
            },
            {
              name: "To",
              value: ["cc", "dd"].includes(prefix)
                ? addresses[i]
                : env.S00_TEST_RECIPIENT_EMAIL,
            },
            {
              name: "Subject",
              value:
                (["cc", "dd"].includes(prefix) ? "Re: " : "") +
                "[S00 TEST] S00-COMPOSIO-" +
                sources.run.token +
                "-M" +
                (i + 1),
            },
            {
              name: "Message-ID",
              value: "<" + prefix + i + "@fictional.test>",
            },
          ],
        },
      })),
    };
  }
  h.fetchImpl = async (input, init) => {
    const path = new URL(String(input)).pathname.replace("/api/v3.1/", ""),
      trace = store.value!.requests.at(-1)!,
      op = trace.op;
    assert.equal(new URL(String(input)).origin, "https://backend.composio.dev");
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal);
    assert.equal(trace.result, "IN_FLIGHT");
    assert.equal(store.value!.calls, calls.length + 1);
    assert.ok(store.value!.calls <= 28);
    assert.equal(new Headers(init?.headers).get("x-api-key"), secret);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ op, body, method: init!.method!, path });
    clock.now += 5;
    const fault = h.fault?.(op, calls.length);
    if (fault instanceof Error) throw fault;
    if (fault) return fault;
    let data: any,
      status = 200;
    if (path === "project/usage/summary") data = { instant_charge: "0" };
    else if (path.startsWith("auth_configs/"))
      data = {
        id: "ac_test",
        toolkit: { slug: "gmail" },
        is_composio_managed: false,
        credentials: {
          scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        },
      };
    else if (path === "connected_accounts/link") {
      assert.equal(init?.method, "POST");
      assert.equal(body.user_id, "shared-owner");
      assert.equal(body.auth_config_id, "ac_test");
      assert.deepEqual(Object.keys(body).sort(), [
        "alias",
        "auth_config_id",
        "user_id",
      ]);
      assert.equal(store.value!.links.at(-1)!.status, "in_flight");
      h.linkCount++;
      status = 201;
      data = {
        connected_account_id: "ca_new" + h.linkCount,
        redirect_url:
          "https://connect.composio.dev/link/" + secret + h.linkCount,
        link_token: secret,
        expires_at: new Date(
          clock.wallNow() + (h.shortLink ? 1000 : 600000),
        ).toISOString(),
      };
    } else if (path.endsWith("/revoke")) {
      assert.equal(path, "connected_accounts/ca_one/revoke");
      assert.equal(init?.method, "POST");
      assert.equal(store.value!.revoke.status, "in_flight");
      h.revoked = h.revocationEffective;
      data = {
        connected_account: { id: "ca_one", status: "REVOKED" },
        revoked_tokens: ["access_token", "refresh_token"],
      };
    } else if (path === "connected_accounts") {
      data = {
        items: [
          {
            id: "ca_new1",
            alias: store.value!.links.at(-1)!.alias,
            user_id: "shared-owner",
            auth_config: { id: "ac_test" },
            toolkit: { slug: "gmail" },
            status: "INITIALIZING",
          },
        ],
        next_cursor: null,
      };
    } else if (path.startsWith("connected_accounts/")) {
      const id = path.split("/")[1],
        isNew = id.startsWith("ca_new"),
        remote = isNew
          ? (h.statuses.shift() ?? (h.oauth ? "ACTIVE" : "INITIALIZING"))
          : id === "ca_one" && h.revoked
            ? "REVOKED"
            : "ACTIVE";
      data = {
        id,
        status: remote,
        user_id: "shared-owner",
        auth_config: { id: "ac_test" },
        toolkit: { slug: "gmail" },
      };
    } else {
      assert.equal(path, "tools/execute/proxy");
      assert.equal(body.method, "GET");
      assert.equal(body.user_id, "shared-owner");
      assert.equal(body.body, undefined);
      assert.ok(
        ["ca_one", "ca_two", "ca_new1", "ca_new2"].includes(
          body.connected_account_id,
        ),
      );
      const url = new URL(body.endpoint);
      assert.equal(url.origin, "https://gmail.googleapis.com");
      if (url.pathname.endsWith("/profile")) {
        if (body.connected_account_id === "ca_one" && h.revoked)
          return json({ status: 401, data: {} });
        data = {
          emailAddress:
            body.connected_account_id === "ca_two" ||
            (h.wrongIdentity && body.connected_account_id.startsWith("ca_new"))
              ? addresses[1]
              : addresses[0],
        };
      } else {
        assert.equal(url.pathname, "/gmail/v1/users/me/threads/111aaa");
        assert.equal(url.searchParams.get("format"), "metadata");
        assert.equal(
          url.searchParams.get("fields"),
          "id,messages(id,threadId,internalDate,payload(headers))",
        );
        data = metadata(0);
      }
      h.alter?.(data, op);
      return json({ status: 200, data });
    }
    h.alter?.(data, op);
    return json(data, status);
  };
  return h;
}
