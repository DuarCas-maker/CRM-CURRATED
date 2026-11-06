import {
  installBrandDelivery,
  bindFixtureAccount,
  queueFixtureMail,
} from "./fixtures/pipeline-os-s02-brand-delivery";
import test, { mock, after } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { featureDatabase } from "./feature-database";
import * as supabase from "../src/lib/server/supabase";

type Result = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number;
};
function localClient(db: Awaited<ReturnType<typeof featureDatabase>>["db"]) {
  const ident = (s: string) => {
    if (!/^[a-z_][a-z_0-9]*$/i.test(s))
      throw Error("Unsafe fixture identifier");
    return '"' + s + '"';
  };
  class Query {
    columns = "*";
    where: string[] = [];
    values: unknown[] = [];
    orders: string[] = [];
    max: number | undefined;
    offset = 0;
    one = false;
    head = false;
    count = false;
    constructor(readonly table: string) {}
    arg(v: unknown) {
      this.values.push(v);
      return "$" + this.values.length;
    }
    select(s = "*", opts?: { head?: boolean; count?: string }) {
      this.columns = s;
      this.head = !!opts?.head;
      this.count = !!opts?.count;
      return this;
    }
    eq(k: string, v: unknown) {
      this.where.push(ident(k) + "=" + this.arg(v));
      return this;
    }
    is(k: string, v: null) {
      this.where.push(ident(k) + " is null");
      return this;
    }
    in(k: string, v: unknown[]) {
      this.where.push(ident(k) + "=any(" + this.arg(v) + ")");
      return this;
    }
    not(k: string, operator: string, v: null) {
      assert.equal(operator, "is");
      this.where.push(ident(k) + " is not null");
      return this;
    }
    order(k: string, opts?: { ascending?: boolean }) {
      this.orders.push(
        ident(k) + (opts?.ascending === false ? " desc" : " asc"),
      );
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    range(a: number, b: number) {
      this.offset = a;
      this.max = b - a + 1;
      return this;
    }
    single() {
      this.one = true;
      return this;
    }
    maybeSingle() {
      this.one = true;
      return this;
    }
    or(filter: string) {
      const m = filter.match(
        /^sent_at\.lt\.([^,]+),and\(sent_at\.eq\.([^,]+),id\.lt\.([^)]+)\)$/,
      );
      if (!m) throw Error("Unsupported fixture filter " + filter);
      this.where.push(
        `(sent_at<${this.arg(m[1])} or (sent_at=${this.arg(m[2])} and id<${this.arg(m[3])}))`,
      );
      return this;
    }
    async execute(): Promise<Result> {
      try {
        const columns =
          this.columns === "*"
            ? "*"
            : this.columns.split(",").map(ident).join(",");
        const base =
          " from " +
          ident(this.table) +
          (this.where.length ? " where " + this.where.join(" and ") : "");
        const rows = (
          await db.query(
            "select " +
              columns +
              base +
              (this.orders.length ? " order by " + this.orders.join(",") : "") +
              (this.max === undefined ? "" : " limit " + this.max) +
              " offset " +
              this.offset,
            this.values,
          )
        ).rows;
        const count = this.count
          ? Number(
              (
                await db.query<{ n: number }>(
                  "select count(*) n" + base,
                  this.values,
                )
              ).rows[0].n,
            )
          : undefined;
        return {
          data: this.head ? null : this.one ? rows[0] || null : rows,
          error: null,
          count,
        };
      } catch (e) {
        return {
          data: null,
          error: {
            message: (e as Error).message,
            code: (e as { code?: string }).code,
          },
        };
      }
    }
    then: Promise<Result>["then"] = (resolve, reject) =>
      this.execute().then(resolve, reject);
  }
  return {
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      try {
        const result = await db.query<{ value: unknown }>(
          "select " +
            ident(name) +
            "(" +
            Object.keys(args)
              .map((key, i) => ident(key) + " => $" + (i + 1))
              .join(",") +
            ") value",
          Object.values(args),
        );
        return { data: result.rows[0]?.value, error: null };
      } catch (e) {
        return {
          data: null,
          error: {
            message: (e as Error).message,
            code: (e as { code?: string }).code,
          },
        };
      }
    },
  } as unknown as SupabaseClient;
}

// Node 22 module mocks are confined to a child when the normal repo test command
// omits the experimental flag. No runtime dependency or package script changes.
if (!process.execArgv.includes("--experimental-test-module-mocks")) {
  test("I02 API suite in an isolated Node 22 module-mock process", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        "--test",
        "tests/pipeline-os-s01-mail-permissions-api.test.ts",
      ],
      { env, encoding: "utf8", timeout: 60000 },
    );
    assert.match(output, /# fail 0/);
  });
} else {
  let network = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    network++;
    throw Error("I02_NETWORK_DISABLED");
  };
  after(() => {
    globalThis.fetch = oldFetch;
    assert.equal(network, 0);
  });

  test("I02 API: per-source denial precedes privileged access and missing SQL fails closed", async () => {
    let serviceCalls = 0;
    const db = {
      rpc: async () => ({ data: false, error: null }),
    } as unknown as SupabaseClient;
    const mocked = mock.module(
      new URL("../src/lib/server/supabase.ts", import.meta.url).href,
      {
        namedExports: {
          ...supabase,
          requireUser: async () => ({
            db,
            profile: { id: randomUUID(), role: "seller" },
          }),
          serviceClient: () => {
            serviceCalls++;
            throw Error("Unexpected privileged access");
          },
        },
      },
    );
    try {
      const { GET } = await import("../src/app/api/documents/[id]/route");
      const denied = await GET(
        new Request("http://fixture.test/api/documents/fixture"),
        { params: Promise.resolve({ id: randomUUID() }) },
      );
      assert.equal(denied.status, 404);
      assert.equal(serviceCalls, 0);
      for (const file of [
        "../src/app/api/mail/uploads/[id]/route",
        "../src/app/api/gmail/files/[id]/route",
      ]) {
        const route = await import(file);
        const response = await route.GET(
          new Request("http://fixture.test/file"),
          { params: Promise.resolve({ id: randomUUID() }) },
        );
        assert.equal(response.status, 404);
      }
      const { requireMailSource, mailAccess } =
        await import("../src/lib/server/mail-access");
      await assert.rejects(
        requireMailSource(db, "document", randomUUID()),
        (e: unknown) => e instanceof supabase.HttpError && e.status === 404,
      );
      const unavailable = {
        rpc: async () => ({
          data: null,
          error: { code: "42883", message: "missing" },
        }),
      } as unknown as SupabaseClient;
      await assert.rejects(
        mailAccess(unavailable, randomUUID()),
        (e: unknown) => e instanceof supabase.HttpError && e.status === 503,
      );
      assert.equal(serviceCalls, 0);
    } finally {
      mocked.restore();
    }
  });

  test("I02 API: archive pages authorize before limit/cursor and outbox bodies stay scoped", async () => {
    const f = await featureDatabase();
    let privileged = 0;
    const oldFlag = process.env.GMAIL_HISTORY_ENABLED;
    process.env.GMAIL_HISTORY_ENABLED = "false";
    const db = localClient(f.db);
    const moduleMock = mock.module(
      new URL("../src/lib/server/supabase.ts", import.meta.url).href,
      {
        namedExports: {
          ...supabase,
          requireUser: async () => ({
            db,
            profile: { id: f.users.seller, role: "seller" },
          }),
          serviceClient: () => {
            privileged++;
            return {
              from: (table: string) => {
                assert.equal(table, "gmail_team_members");
                return {
                  select: () => ({
                    in: async () => ({ data: [], error: null }),
                  }),
                };
              },
            };
          },
        },
      },
    );
    const cryptoMock = mock.module(
      new URL("../src/lib/server/crypto.ts", import.meta.url).href,
      { namedExports: { decrypt: (s: string) => s } },
    );
    try {
      const contact = randomUUID(),
        caseId = randomUUID(),
        account = randomUUID(),
        co = randomUUID();
      await f.db.query(
        "insert into contacts(id,email,name,verification) values($1,'client@api.test','Fixture','valid')",
        [contact],
      );
      await f.db.query(
        "insert into opportunities(id,contact_id,company,seller_id,closer_id,handed_off_at) values($1,$2,'Fixture',$3,$4,'2026-01-02')",
        [caseId, contact, f.users.seller, f.users.closer],
      );
      await f.db.query(
        "insert into mail_accounts(id,email,organization) values($1,'sender@api.test','fixture')",
        [account],
      );
      await f.db.query(
        "insert into conversations(id,opportunity_id,account_id,gmail_thread_id,subject,area) values($1,$2,$3,'thread','Hidden subject','seller')",
        [co, caseId, account],
      );
      const visible: string[] = [];
      for (let i = 0; i < 120; i++) {
        const id = randomUUID();
        // Use an epoch increment to avoid invalid minute values on dense fixtures.
        const sent = new Date(
          Date.parse(i < 55 ? "2026-01-01" : "2026-01-03") + i * 1000,
        ).toISOString();
        const snapshot = {
          gmail_message_id: id,
          subject: "Visible source",
          sent_at: sent,
          direction: "inbound",
          body: "Fixture",
          participants: [{ role: "from", email: "client@api.test" }],
          attachments: [],
        };
        await f.db.query(
          "insert into gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,subject,sent_at,direction,nature,participants,encrypted_payload) values($1,$2,$1::uuid::text,'thread','Fixture',$3,'inbound','personal',$4,$5)",
          [
            id,
            account,
            sent,
            JSON.stringify(snapshot.participants),
            JSON.stringify(snapshot),
          ],
        );
        await f.db.query(
          "insert into case_events(opportunity_id,archive_message_id,area,kind,body,evidence_type,occurred_at) values($1,$2,$3,'mail','Fixture','explicit',$4)",
          [caseId, id, i < 55 ? "seller" : "closer", sent],
        );
        if (i < 55) visible.push(id);
      }
      const msg = randomUUID();
      await f.db.query(
        "insert into messages(id,conversation_id,gmail_message_id,direction,sender,body,sent_at,status) values($1,$2,'seller','inbound','client@api.test','Visible','2026-01-01','received')",
        [msg, co],
      );
      await f.db.query(
        "insert into outbox(account_id,opportunity_id,conversation_id,reply_message_id,to_email,subject,body,area,message_id_header,request_key) values($1,$2,$3,$4,'hidden@api.test','Secret','Hidden outbox body','closer','hidden-header','hidden-key')",
        [account, caseId, co, msg],
      );
      await f.db.exec("set pipeline_os.i02_sandbox='in_memory_test'");
      await f.db.exec(
        await readFile(
          "tests/fixtures/pipeline-os-s01/t01-02-i02-mail-permissions.sql",
          "utf8",
        ),
      );
      await f.asUser(f.users.seller);
      const { GET: thread } =
        await import("../src/app/api/gmail/archive/[id]/thread/route");
      const first = await thread(
        new Request("http://fixture.test/api/thread"),
        { params: Promise.resolve({ id: visible[0] }) },
      );
      assert.equal(first.status, 200);
      const page = await first.json();
      assert.equal(page.messages.length, 50);
      assert.equal(page.hasMore, true);
      assert.ok(
        page.messages.every((m: { archive_id: string }) =>
          visible.includes(m.archive_id),
        ),
      );
      const second = await thread(
        new Request(
          "http://fixture.test/api/thread?before=" +
            encodeURIComponent(page.cursor.before) +
            "&cursor=" +
            page.cursor.cursor,
        ),
        { params: Promise.resolve({ id: visible[0] }) },
      );
      const tail = await second.json();
      assert.equal(second.status, 200);
      assert.equal(tail.messages.length, 5);
      assert.equal(tail.hasMore, false);
      const { GET: messages } =
        await import("../src/app/api/conversations/[id]/messages/route");
      const result = await messages(
        new Request("http://fixture.test/api/messages"),
        { params: Promise.resolve({ id: co }) },
      );
      assert.equal(result.status, 200);
      const payload = await result.json();
      assert.equal(payload.messages.length, 1);
      assert.deepEqual(payload.sends, []);
      assert.ok(!JSON.stringify(payload).includes("Hidden outbox body"));
      const { GET: channels } =
        await import("../src/app/api/conversations/channels/route");
      const firstChannels = await channels(
        new Request("http://fixture.test/api/channels?case=" + caseId),
      );
      assert.equal(
        firstChannels.status,
        200,
        JSON.stringify(await firstChannels.clone().json()),
      );
      const initial = await firstChannels.json();
      await f.db.exec("reset role");
      await f.db.query(
        "update conversations set subject='Hidden replacement',needs_attention=true,updated_at='2026-09-01' where id=$1",
        [co],
      );
      await f.db.query(
        "insert into messages(conversation_id,gmail_message_id,direction,sender,body,sent_at,status) values($1,'private-extra','inbound','hidden@api.test','Hidden closer','2026-09-01','received')",
        [co],
      );
      await f.db.query(
        "insert into financing_processes(opportunity_id,sequence_number,started_at,classification,label) values($1,99,now(),'active','Hidden process')",
        [caseId],
      );
      await f.asUser(f.users.seller);
      const added = await channels(
        new Request("http://fixture.test/api/channels?case=" + caseId),
      );
      assert.equal(added.status, 200);
      assert.ok(
        isDeepStrictEqual(await added.json(), initial),
        "hidden activity must not change the full channels response",
      );
      assert.ok(
        privileged > 0,
        "only authorized team-label enrichment uses the service stub",
      );
    } finally {
      moduleMock.restore();
      cryptoMock.restore();
      await f.db.close();
      if (oldFlag === undefined) delete process.env.GMAIL_HISTORY_ENABLED;
      else process.env.GMAIL_HISTORY_ENABLED = oldFlag;
    }
  });

  test("I02 worker function: revocation after reservation stops before the fake transport", async () => {
    const f = await featureDatabase();
    let transports = 0,
      guards = 0;
    const actor = f.users.seller,
      account = randomUUID(),
      contact = randomUUID(),
      caseId = randomUUID();
    let message: string = randomUUID();
    let dbMock: ReturnType<typeof mock.module> | undefined,
      googleMock: ReturnType<typeof mock.module> | undefined;
    try {
      await f.db.query(
        "insert into contacts(id,email,name,verification) values($1,'worker@fixture.test','Fixture','valid')",
        [contact],
      );
      await f.db.query(
        "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Fixture',$3)",
        [caseId, contact, actor],
      );
      await f.db.query(
        "insert into mail_accounts(id,email,organization) values($1,'sender@fixture.test','fixture')",
        [account],
      );
      await f.db.query(
        "insert into mail_permissions(account_id,user_id,can_send) values($1,$2,true)",
        [account, actor],
      );
      await f.db.exec("set pipeline_os.i02_sandbox='in_memory_test'");
      await f.db.exec(
        await readFile(
          "tests/fixtures/pipeline-os-s01/t01-02-i02-mail-permissions.sql",
          "utf8",
        ),
      );
      await installBrandDelivery(f);
      const preparation = await bindFixtureAccount(f, account, actor);
      message = await queueFixtureMail(f, account, actor, caseId, preparation);
      const client = {
        rpc: async (
          name: string,
          p?: { message: string; claim_token: string },
        ) => {
          if (name === "claim_outbox")
            return {
              data: (await f.db.query("select * from claim_outbox()")).rows,
              error: null,
            };
          if (name === "admit_brand_dispatch") {
            guards++;
            return {
              data: (
                await f.db.query<{ allowed: string | null }>(
                  "select admit_brand_dispatch($1,$2) allowed",
                  [p!.message, p!.claim_token],
                )
              ).rows[0].allowed,
              error: null,
            };
          }
          throw Error("Unexpected worker RPC " + name);
        },
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              single: async () => {
                assert.equal(table, "mail_accounts");
                return { data: { email: "sender@fixture.test" }, error: null };
              },
            }),
          }),
          update: (value: unknown) => ({
            eq: async () => {
              assert.equal(table, "outbox");
              assert.deepEqual(value, { attachment_snapshot: [] });
              return { data: null, error: null };
            },
          }),
        }),
      };
      dbMock = mock.module(new URL("../worker/db.ts", import.meta.url).href, {
        namedExports: {
          db: () => client,
          checked: (r: { data: unknown; error: unknown }) => {
            assert.equal(r.error, null);
            return r.data;
          },
          alertAdmins: () => {
            throw Error("Unexpected alert");
          },
        },
      });
      googleMock = mock.module(
        new URL("../src/lib/server/google.ts", import.meta.url).href,
        {
          namedExports: {
            GmailError: class extends Error {},
            organization: () => ({}),
            gmail: async (
              _account: string,
              path: string,
              _init: unknown,
              before: () => Promise<void>,
            ) => {
              assert.equal(path, "messages/send");
              await f.db.query("update profiles set active=false where id=$1", [
                actor,
              ]);
              await before(); // The actual worker callback invokes the SQL guard.
              transports++;
              return { id: "fake", threadId: "fake" };
            },
          },
        },
      );
      const { sendNext } = await import("../worker/gmail");
      await sendNext();
      assert.equal(guards, 1);
      assert.equal(transports, 0);
      assert.equal(
        (
          await f.db.query<{ status: string }>(
            "select status from outbox where id=$1",
            [message],
          )
        ).rows[0].status,
        "paused",
      );
    } finally {
      dbMock?.restore();
      googleMock?.restore();
      await f.db.close();
    }
  });

  test("I02 composer exposes a read-only state without rendering the send form", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { MailComposer } = await import("../src/components/mail-composer");
    type Props = Parameters<typeof MailComposer>[0];
    const id = randomUUID();
    const props = {
      data: {
        demo: false,
        mail_access: { [id]: { area: "closer", can_write: false } },
      },
      locale: "es",
      opportunity: { id },
      act: async () => undefined,
      busy: false,
      close: () => {},
    } as unknown as Props;
    const html = renderToStaticMarkup(createElement(MailComposer, props));
    assert.match(html, /role="status"/);
    assert.match(html, /solo lectura/);
    assert.ok(!html.includes("<form"));
  });
}
