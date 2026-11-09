import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  transportCommand,
  transportPage,
  transportRequest,
} from "../src/lib/mail-transport-selection";
import {
  executeSelectedTransport,
  TransportSelectionError,
  type SelectionPorts,
  type TransportTicket,
} from "../src/lib/server/mail-transport/selection";

function fixture(
  provider: "gmail_oauth" | "composio" = "gmail_oauth",
  send = false,
) {
  const account = randomUUID(),
    calls: string[] = [],
    now = { value: Date.now() },
    outcomes: string[] = [];
  const input = {
    account_id: account,
    expected_revision: 2,
    operation: send ? "send" : "thread",
    resource: send ? randomUUID() : "abc123",
  };
  const ticket: TransportTicket = {
    id: randomUUID(),
    account_id: account,
    provider,
    revision: 2,
    operation: send ? "send" : "thread",
    resource: input.resource,
    deadline: new Date(now.value + 30000).toISOString(),
    binding:
      provider === "composio"
        ? {
            accountId: account,
            connectedAccountId: "ca_fixture",
            authConfigId: "ac_fixture",
            userId: "fixture-owner",
            mailboxEmail: "one@example.test",
            verifiedMailboxEmail: "one@example.test",
            identityVerified: true,
            status: "active",
            revision: 1,
            quotaProjectId: "fixture-quota",
          }
        : null,
  };
  const ports: SelectionPorts = {
    acquire: async (p, hash) => {
      calls.push("acquire");
      assert.deepEqual(p, input);
      assert.match(hash, /^[a-f0-9]{64}$/);
      return ticket;
    },
    validate: async (_, cap) => {
      calls.push("validate");
      assert.match(cap, /^[a-f0-9]{64}$/);
      return true;
    },
    beforeCredential: async () => {
      calls.push("beforeCredential");
    },
    prepareDirect: async () => {
      calls.push("direct");
      return "private-direct";
    },
    prepareComposio: async (_, b) => {
      calls.push("composio");
      assert.equal(b.accountId, account);
      return "private-composio";
    },
    quota: async () => {
      calls.push("quota");
    },
    beforeRequest: async () => {
      calls.push("hook");
    },
    admit: async () => {
      calls.push("admit");
      return true;
    },
    execute: async <T>() => {
      calls.push("wire");
      return { ok: true } as T;
    },
    finish: async (_, __, outcome) => {
      calls.push("finish");
      outcomes.push(outcome);
    },
    now: () => now.value,
  };
  return { input, ticket, ports, calls, outcomes, now };
}
test("R06 resolver: strict contracts and no implicit activation", async (t) => {
  await t.test(
    "malformed resource/account/revision rejected before store or credentials",
    async () => {
      for (const change of [
        { resource: "https://other.test/path" },
        { resource: "abc/../../profile" },
        { expected_revision: -1 },
        { account_id: "other" },
        { api_key: "fictional-secret" },
      ]) {
        const f = fixture();
        await assert.rejects(
          executeSelectedTransport({ ...f.input, ...change }, f.ports),
          /R06_INVALID_INPUT/,
        );
        assert.deepEqual(f.calls, []);
      }
      assert(
        !transportRequest.safeParse({
          account_id: randomUUID(),
          expected_revision: 0,
          operation: "send",
          resource: "messages/send",
        }).success,
      );
      assert(
        !transportPage.safeParse({
          account_id: randomUUID(),
          provider: "composio",
          state: "ready",
          revision: 1,
          target_provider: null,
          binding_id: null,
          api_key: "not-allowed",
        }).success,
      );
      assert(
        !transportCommand.safeParse({
          kind: "activate_all",
          payload: {},
          idempotency_key: randomUUID(),
        }).success,
      );
    },
  );
  for (const provider of ["gmail_oauth", "composio"] as const)
    await t.test(
      `${provider}: resolution precedes credentials; quota/hook/admission once`,
      async () => {
        const f = fixture(provider);
        assert.deepEqual(await executeSelectedTransport(f.input, f.ports), {
          ok: true,
        });
        assert.deepEqual(f.calls, [
          "acquire",
          "validate",
          "beforeCredential",
          "validate",
          provider === "composio" ? "composio" : "direct",
          "quota",
          "hook",
          "admit",
          "wire",
          "finish",
        ]);
        assert.deepEqual(f.outcomes, ["finished"]);
      },
    );
  await t.test(
    "missing/error store never selects a default provider",
    async () => {
      for (const result of [null, {}, "gmail_oauth"]) {
        const f = fixture();
        f.ports.acquire = async () => result;
        await assert.rejects(
          executeSelectedTransport(f.input, f.ports),
          /R06_UNAVAILABLE/,
        );
        assert(!f.calls.includes("direct"));
      }
      const f = fixture();
      f.ports.acquire = async () => {
        throw new Error("fictional-sensitive-provider-text");
      };
      await assert.rejects(
        executeSelectedTransport(f.input, f.ports),
        (e: unknown) =>
          e instanceof TransportSelectionError &&
          e.message === "R06_UNAVAILABLE" &&
          !("cause" in e),
      );
    },
  );
  await t.test(
    "foreign account/revision/operation/binding cannot prepare credentials",
    async () => {
      for (const update of [
        { account_id: randomUUID() },
        { revision: 3 },
        { resource: "wrong" },
        { operation: "profile" },
        { provider: "composio", binding: null },
      ]) {
        const f = fixture();
        f.ports.acquire = async () => ({ ...f.ticket, ...update });
        await assert.rejects(
          executeSelectedTransport(f.input, f.ports),
          TransportSelectionError,
        );
        assert(!f.calls.includes("direct"));
        assert(!f.calls.includes("wire"));
      }
      const f = fixture("composio");
      f.ticket.binding!.verifiedMailboxEmail = "other@example.test";
      await assert.rejects(
        executeSelectedTransport(f.input, f.ports),
        /R06_UNAVAILABLE/,
      );
      assert(!f.calls.includes("composio"));
    },
  );
  await t.test(
    "exhausted budget rejects before OAuth or proxy preparation",
    async () => {
      for (const p of ["gmail_oauth", "composio"] as const) {
        const f = fixture(p);
        f.ports.beforeCredential = async () => {
          throw Error("budget");
        };
        await assert.rejects(
          executeSelectedTransport(f.input, f.ports),
          /R06_UNAVAILABLE/,
        );
        assert(!f.calls.includes("direct"));
        assert(!f.calls.includes("composio"));
        assert(!f.calls.includes("wire"));
        assert.deepEqual(f.outcomes, ["cancelled_before_wire"]);
      }
    },
  );
  await t.test(
    "revocation while checking budget denies before preparing credentials",
    async () => {
      const f = fixture();
      let valid = true;
      f.ports.validate = async () => valid;
      f.ports.beforeCredential = async () => {
        valid = false;
      };
      await assert.rejects(
        executeSelectedTransport(f.input, f.ports),
        /R06_DENIED/,
      );
      assert(!f.calls.includes("direct"));
      assert(!f.calls.includes("wire"));
    },
  );
  await t.test(
    "ticket snapshot cannot be retargeted by a dependency in flight",
    async () => {
      const f = fixture("composio");
      f.ports.validate = async (t) => {
        t.binding!.connectedAccountId = "ca_other";
        return true;
      };
      await assert.rejects(
        executeSelectedTransport(f.input, f.ports),
        /R06_UNAVAILABLE/,
      );
      assert(!f.calls.includes("composio"));
      assert(!f.calls.includes("wire"));
    },
  );
  await t.test("closed/expired lease denies before credentials", async () => {
    const a = fixture();
    a.now.value += 60000;
    await assert.rejects(
      executeSelectedTransport(a.input, a.ports),
      /R06_DENIED/,
    );
    assert(!a.calls.includes("direct"));
    const b = fixture();
    b.ports.validate = async () => false;
    await assert.rejects(
      executeSelectedTransport(b.input, b.ports),
      /R06_DENIED/,
    );
    assert(!b.calls.includes("direct"));
  });
  await t.test(
    "revocation during quota, final hook failure or expiry prevents wire",
    async () => {
      const a = fixture();
      a.ports.admit = async () => false;
      await assert.rejects(
        executeSelectedTransport(a.input, a.ports),
        /R06_DENIED/,
      );
      assert(!a.calls.includes("wire"));
      const b = fixture();
      b.ports.beforeRequest = async () => {
        throw Error("revoked");
      };
      await assert.rejects(
        executeSelectedTransport(b.input, b.ports),
        /R06_UNAVAILABLE/,
      );
      assert(!b.calls.includes("admit"));
      const c = fixture();
      c.ports.quota = async () => {
        c.now.value += 60000;
      };
      await assert.rejects(
        executeSelectedTransport(c.input, c.ports),
        /R06_DENIED/,
      );
      assert(!c.calls.includes("wire"));
    },
  );
  await t.test(
    "ambiguous proxy send makes one attempt, retains uncertainty and never falls back",
    async () => {
      const f = fixture("composio", true);
      f.ports.execute = async () => {
        f.calls.push("wire");
        throw Error("fictional-401-or-timeout");
      };
      await assert.rejects(
        executeSelectedTransport(f.input, f.ports),
        (e: unknown) =>
          e instanceof TransportSelectionError &&
          e.deliveryUncertain &&
          e.code === "R06_UNCERTAIN",
      );
      assert.equal(f.calls.filter((x) => x === "wire").length, 1);
      assert(!f.calls.includes("direct"));
      assert.deepEqual(f.outcomes, ["uncertain"]);
    },
  );
  await t.test(
    "accepted result with failed persistence does not return success or retry",
    async () => {
      const f = fixture("composio", true);
      f.ports.finish = async (_, __, outcome) => {
        f.outcomes.push(outcome);
        if (outcome === "finished") throw Error("db-response-lost");
      };
      await assert.rejects(
        executeSelectedTransport(f.input, f.ports),
        (e: unknown) =>
          e instanceof TransportSelectionError && e.deliveryUncertain,
      );
      assert.equal(f.calls.filter((x) => x === "wire").length, 1);
      assert.deepEqual(f.outcomes, ["finished", "uncertain"]);
    },
  );
  await t.test(
    "cleanup failure preserves sanitized failure; reads do not claim an uncertain delivery",
    async () => {
      const f = fixture("composio");
      f.ports.execute = async () => {
        throw Error("read-failed");
      };
      f.ports.finish = async () => {
        throw Error("cleanup-failed");
      };
      await assert.rejects(
        executeSelectedTransport(f.input, f.ports),
        (e: unknown) =>
          e instanceof TransportSelectionError &&
          !e.deliveryUncertain &&
          e.message === "R06_UNCERTAIN",
      );
      assert(!f.calls.includes("direct"));
    },
  );
});
