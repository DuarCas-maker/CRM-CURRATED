import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fakeBrandEnvelope } from "./fixtures/pipeline-os-s02-brand-delivery";
if (!process.execArgv.includes("--experimental-test-module-mocks")) {
  test("manual sender integration runs with isolated module mocks", () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        "./tests/offline.mjs",
        "--import",
        "tsx",
        "--experimental-test-module-mocks",
        "--test",
        "--test-reporter=tap",
        "tests/manual-mail-api.test.ts",
      ],
      { env, encoding: "utf8", windowsHide: true, timeout: 30000 },
    );
    assert.match(output, /# fail 0/);
  });
} else
  test("actual sender uses exact manual claims, rejects foreign DTOs and never replays an ambiguous POST", async (t) => {
    const account = randomUUID();
    let selected: Record<string, unknown> | null = null,
      claimed = false,
      wire = 0,
      timeout = false,
      status = "",
      reads = 0;
    const rpcCalls: string[] = [];
    const client = {
      from: () => {
        reads++;
        const q = {
          select: () => q,
          eq: () => q,
          neq: () => q,
          update: (p: { status?: string }) => {
            if (p.status) status = p.status;
            return q;
          },
          single: async () => ({
            data: { email: "sender@latency.test" },
            error: null,
          }),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        };
        return q;
      },
      rpc: async (name: string, p: Record<string, unknown>) => {
        rpcCalls.push(name);
        if (name === "claim_manual_outbox") {
          assert.equal(p.account, account);
          const data = selected && !claimed ? [selected] : [];
          claimed = true;
          return { data, error: null };
        }
        if (name === "admit_brand_dispatch")
          return { data: randomUUID(), error: null };
        if (name === "mark_sent") {
          status = "sent";
          return { data: null, error: null };
        }
        if (name === "brand_dispatch_uncertain")
          return { data: null, error: null };
        throw Error("UNEXPECTED_RPC_" + name);
      },
    };
    const database = mock.module("../worker/db.ts", {
      namedExports: {
        db: () => client,
        checked: (r: { data: unknown; error: unknown }) => {
          if (r.error) throw Error("fixture DB error");
          return r.data;
        },
        alertAdmins: async () => {},
      },
    });
    const google = mock.module("../src/lib/server/google.ts", {
      namedExports: {
        gmail: async (
          a: string,
          path: string,
          _init: unknown,
          before?: () => Promise<void>,
        ) => {
          assert.equal(a, account);
          assert.equal(path, "messages/send");
          await before?.();
          wire++;
          if (timeout) throw Error("fixture timeout after POST");
          return { id: "fixture-message", threadId: "fixture-thread" };
        },
        GmailError: class extends Error {},
        organization: () => ({ domain: "latency.test" }),
      },
    });
    const fresh = () => {
      selected = {
        ...fakeBrandEnvelope(account),
        id: randomUUID(),
        account_id: account,
        requested_by: randomUUID(),
        opportunity_id: randomUUID(),
        signature_html: "",
        sender_name: "",
        subject: "Fixture",
        body: "Fixture",
        to_email: "client@latency.test",
        message_id_header: "<fixture@latency.test>",
        cc_emails: [],
        bcc_emails: [],
        attachment_ids: [],
        upload_ids: [],
        gmail_file_ids: [],
        campaign_asset_snapshot: [],
      };
      claimed = false;
      wire = 0;
      reads = 0;
      status = "";
      timeout = false;
      rpcCalls.length = 0;
    };
    try {
      const { sendNext } = await import("../worker/gmail.ts");
      await t.test(
        "no ready manual never falls back to global or notification claim",
        async () => {
          fresh();
          selected = null;
          await sendNext({ manualAccount: account });
          assert.deepEqual(rpcCalls, ["claim_manual_outbox"]);
          assert.equal(wire, 0);
        },
      );
      await t.test(
        "ambiguous or invalid selector fails before any DB claim",
        async () => {
          fresh();
          await assert.rejects(sendNext({} as never), /INVALID_MAIL_SELECTION/);
          await assert.rejects(
            sendNext({
              manualAccount: account,
              pilotId: randomUUID(),
              lease: "a".repeat(64),
            } as never),
            /INVALID_MAIL_SELECTION/,
          );
          assert.equal(rpcCalls.length, 0);
        },
      );
      await t.test(
        "foreign mailbox or campaign DTO is rejected before transport or account reads",
        async () => {
          for (const override of [
            { account_id: randomUUID() },
            { campaign_test: true },
            { enrollment_id: randomUUID() },
            { notification_id: randomUUID() },
          ]) {
            fresh();
            Object.assign(selected!, override);
            await assert.rejects(
              sendNext({ manualAccount: account }),
              /MANUAL_MAIL_SCOPE_MISMATCH/,
            );
            assert.equal(wire, 0);
            assert.equal(reads, 0);
          }
        },
      );
      await t.test(
        "a valid manual uses the existing admission and marks accepted once",
        async () => {
          fresh();
          await sendNext({ manualAccount: account });
          await sendNext({ manualAccount: account });
          assert.equal(wire, 1);
          assert.equal(status, "sent");
          assert.deepEqual(rpcCalls, [
            "claim_manual_outbox",
            "admit_brand_dispatch",
            "mark_sent",
            "claim_manual_outbox",
          ]);
        },
      );
      await t.test(
        "an ambiguous POST preserves uncertain and never invokes another POST",
        async () => {
          fresh();
          timeout = true;
          await sendNext({ manualAccount: account });
          await sendNext({ manualAccount: account });
          assert.equal(wire, 1);
          assert.equal(status, "uncertain");
          assert(rpcCalls.includes("brand_dispatch_uncertain"));
        },
      );
    } finally {
      google.restore();
      database.restore();
    }
  });
