import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { teamIdentitySchema } from "../src/lib/gmail-team";
import { encrypt } from "../src/lib/server/crypto";
import { linkTeamThread } from "../worker/gmail-archive";
import { syncMessage } from "../worker/gmail";
import { OAuth2Client } from "google-auth-library";

test("team identity validates an exact email without implicitly granting or requiring CRM membership", () => {
  const member = teamIdentitySchema.parse({
    email: "Valentina@Example.com",
    name: "Valentina",
    team_role: "seller",
    affiliation: "external",
    profile_id: null,
  });
  assert.equal(member.email, "valentina@example.com");
  assert.equal(member.profile_id, null);
  assert.equal(
    teamIdentitySchema.safeParse({ ...member, team_role: "lender" }).success,
    false,
  );
  assert.equal(
    teamIdentitySchema.safeParse({ ...member, email: "example.com" }).success,
    false,
  );
});

test("team thread worker retries a partial page without advancing its persistent cursor", async () => {
  const oldFetch = globalThis.fetch;
  const keys = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "INTEGRATION_ENCRYPTION_KEY",
  ] as const;
  const previous = keys.map((k) => process.env[k]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://team-fixture.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service";
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString(
    "base64",
  );
  let failed = false,
    linked = 0,
    next = 0,
    followups = 0;
  const archive = Array.from({ length: 10 }, () => ({
    id: randomUUID(),
    encrypted_payload: encrypt(
      JSON.stringify({
        body: "Fixture",
        participants: [],
        direction: "inbound",
        nature: "personal",
        sent_at: new Date().toISOString(),
        attachments: [],
      }),
    ),
  }));
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path.endsWith("/rpc/gmail_team_thread_page"))
      return Response.json(body.cursor_offset === 0 ? archive : []);
    if (path.endsWith("/rpc/gmail_record_reply")) return Response.json(null);
    if (path.endsWith("/rpc/gmail_link_message")) {
      linked++;
      if (!failed && linked === 4) {
        failed = true;
        return Response.json(
          { message: "Fixture interrupted" },
          { status: 500 },
        );
      }
      return Response.json(randomUUID());
    }
    if (path.endsWith("/gmail_saved_attachments")) return Response.json([]);
    if (path.endsWith("/jobs")) {
      assert.equal(body.payload.offset, 10);
      next++;
      return Response.json(null);
    }
    if (path.endsWith("/rpc/gmail_followups")) {
      followups++;
      return Response.json(null);
    }
    throw new Error(`Unexpected fixture request ${path}`);
  };
  try {
    const evidence = randomUUID(),
      copySince = new Date().toISOString();
    await assert.rejects(
      linkTeamThread(evidence, 0, copySince),
      /DATABASE_OPERATION_FAILED/,
    );
    assert.equal(next, 0);
    assert.equal(followups, 0);
    await linkTeamThread(evidence, 0, copySince);
    assert.equal(linked, 14);
    assert.equal(next, 1);
    await linkTeamThread(evidence, 10, copySince);
    assert.equal(followups, 1);
  } finally {
    globalThis.fetch = oldFetch;
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
});

test("team history associates separate cases, preserves ownership and requires evidence to resolve lender waits", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated,anon,service_role;grant select on storage.objects to authenticated;`);
    for (const file of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const admin = randomUUID(),
      seller = randomUUID(),
      closer = randomUUID(),
      stranger = randomUUID(),
      account = randomUUID(),
      run = randomUUID();
    for (const [id, role] of [
      [admin, "superadmin"],
      [seller, "seller"],
      [closer, "closer"],
      [stranger, "seller"],
    ]) {
      await db.query("insert into auth.users values($1,$2)", [
        id,
        `${id}@example.com`,
      ]);
      await db.query(
        "insert into profiles(id,name,email,role) values($1,$2::text,$3,$2::app_role)",
        [id, role, `${id}@example.com`],
      );
    }
    const register = (actor = admin, profile: string | null = null) =>
      db.query(
        "select gmail_register_team('Valentina@Example.com','Valentina','seller','external',$1,$2)",
        [profile, actor],
      );
    await assert.rejects(register(seller), /Superadmin/);
    await assert.rejects(register(admin, closer), /matching role/);
    await register();
    await register(admin, seller);
    assert.equal(
      (await db.query("select * from gmail_team_members")).rows.length,
      1,
    );
    assert.equal((await db.query("select * from contacts")).rows.length, 0);
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id,status,sync_enabled) values($1,'owner@example.com','org',$2,'connected',true)",
      [account, seller],
    );
    await db.query(
      "insert into gmail_runs(id,account_id,purpose,from_at,until_at,copy_since,created_by) values($1,$2,'historical',now()-interval '1 year',now(),now()-interval '2 months',$3)",
      [run, account, admin],
    );
    const lease = (
      await db.query<{ lease_token: string }>(
        "select * from gmail_claim_run($1)",
        [run],
      )
    ).rows[0].lease_token;
    async function store(
      thread: string,
      from: string,
      to: string,
      direction = "inbound",
      days = 6,
    ) {
      const id = randomUUID();
      return (
        await db.query<{ id: string }>(
          "select gmail_store_message($1,$2,$3) id",
          [
            run,
            lease,
            JSON.stringify({
              gmail_message_id: id,
              gmail_thread_id: thread,
              internet_message_id: `<${id}@example.com>`,
              subject: thread,
              sent_at: new Date(Date.now() - days * 86400000).toISOString(),
              direction,
              nature: "personal",
              participants: [
                { email: from, name: from, role: "from" },
                { email: to, name: to, role: "to" },
              ],
              attachment_index: [],
              encrypted_payload: "fixture",
            }),
          ],
        )
      ).rows[0].id;
    }
    const sent = await store(
      "client-A-lender",
      "owner@example.com",
      "lender@example.com",
      "outbound",
      7,
    );
    const response = await store(
      "client-A-lender",
      "valentina@example.com",
      "owner@example.com",
      "inbound",
      6,
    );
    const second = await store(
      "client-B",
      "valentina@example.com",
      "owner@example.com",
      "inbound",
      5,
    );
    const unknown = await store(
      "unknown",
      "valentina@example.com",
      "owner@example.com",
      "inbound",
      4,
    );
    await db.query("select gmail_build_preview($1,$2)", [run, lease]);
    const candidate = (
      await db.query<{
        id: string;
        participant_kind: string;
        selected: boolean;
      }>(
        "select * from gmail_candidates where run_id=$1 and email='valentina@example.com'",
        [run],
      )
    ).rows[0];
    assert.equal(candidate.participant_kind, "team");
    assert.equal(candidate.selected, false);
    // Protect against a stale UI disguising a registered team address as a customer.
    await db.query(
      "update gmail_candidates set participant_kind='client',classification='active',selected=true where id=$1",
      [candidate.id],
    );
    await db.query(
      "update gmail_runs set status='importing',lease_token=$2 where id=$1",
      [run, lease],
    );
    await assert.rejects(
      db.query("select gmail_apply_candidate($1,$2)", [candidate.id, lease]),
      /Team members/,
    );
    await register();
    await db.query("update gmail_runs set status='review' where id=$1", [run]);
    const cases = [] as { id: string; process: string }[];
    for (const companyName of ["Client A", "Client B"]) {
      const company = randomUUID(),
        contact = randomUUID(),
        id = randomUUID(),
        process = randomUUID();
      await db.query("insert into companies(id,name) values($1,$2)", [
        company,
        companyName,
      ]);
      await db.query(
        "insert into contacts(id,company_id,email,verification) values($1,$2,$3,'valid')",
        [contact, company, `${contact}@example.com`],
      );
      await db.query(
        "insert into opportunities(id,company_id,contact_id,company,seller_id,closer_id,handed_off_at,owner_locked_at) values($1,$2,$3,$4,$5,$6,now(),now())",
        [id, company, contact, companyName, seller, closer],
      );
      await db.query(
        "insert into financing_processes(id,opportunity_id,sequence_number,started_at,classification,label) values($1,$2,1,now(),'active','Current')",
        [process, id],
      );
      cases.push({ id, process });
    }
    const lender = randomUUID(),
      submission = randomUUID();
    await db.query(
      "insert into lenders(id,name,email,channel) values($1,'Lender','lender@example.com','email')",
      [lender],
    );
    await db.query(
      "insert into submissions(id,opportunity_id,process_id,lender_id,closer_id,channel,next_action,next_action_at) values($1,$2,$3,$4,$5,'email','Wait',now())",
      [submission, cases[0].id, cases[0].process, lender, closer],
    );
    const associate = (
      evidence: string,
      c = cases[0],
      sub: string | null = submission,
    ) =>
      db.query("select gmail_associate_team_thread($1,$2,$3,$4,$5,$6)", [
        candidate.id,
        evidence,
        c.id,
        c.process,
        sub,
        admin,
      ]);
    await associate(response);
    await associate(response);
    await associate(second, cases[1], null);
    await assert.rejects(
      associate(second, cases[0], null),
      /already associated/,
    );
    assert.equal(
      (await db.query("select * from jobs where kind='gmail_team_thread'")).rows
        .length,
      2,
    );
    assert.equal(
      (
        await db.query(
          "select * from contacts where email='valentina@example.com'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from opportunities where seller_id=$1 and closer_id=$2",
          [seller, closer],
        )
      ).rows.length,
      2,
    );
    assert.equal(
      (await db.query("select * from company_contacts")).rows.length,
      0,
    );
    const link = (id: string) =>
      db.query("select gmail_link_message($1,$2)", [
        id,
        JSON.stringify({ body: "Evidence body" }),
      ]);
    await link(sent);
    await db.query("select gmail_followups()");
    const before = (
      await db.query<{
        id: string;
        waiting_for: string;
        since_at: string;
        task_id: string;
      }>("select * from mail_waits")
    ).rows[0];
    assert.equal(before.waiting_for, "lender");
    assert.ok(before.task_id);
    await link(response);
    await link(response);
    await link(second);
    const after = (
      await db.query<{ waiting_for: string; since_at: string }>(
        "select * from mail_waits where id=$1",
        [before.id],
      )
    ).rows[0];
    assert.equal(after.waiting_for, "lender");
    assert.deepEqual(after.since_at, before.since_at);
    assert.equal(
      (await db.query("select * from tasks where status='open'")).rows.length,
      1,
    );
    await db.query("select gmail_associate_continuous($1)", [unknown]);
    assert.equal(
      (
        await db.query(
          "select * from gmail_thread_links where gmail_thread_id='unknown'",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select gmail_confirm_team_response($1,$2,$3,'Review')", [
        before.id,
        second,
        closer,
      ]),
      /newer personal team/,
    );
    await assert.rejects(
      db.query("select gmail_confirm_team_response($1,$2,$3,'')", [
        before.id,
        response,
        closer,
      ]),
      /Explain/,
    );
    await db.query(
      "select gmail_confirm_team_response($1,$2,$3,'Valentina relayed the lender request; reviewed email')",
      [before.id, response, closer],
    );
    await db.query("select gmail_confirm_team_response($1,$2,$3,'Retry')", [
      before.id,
      response,
      closer,
    ]);
    await db.query("select gmail_followups()");
    await link(response);
    assert.equal(
      (
        await db.query(
          "select * from mail_waits where waiting_for='team' and resolution_message_id is not null",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from tasks where status='open' and title='Five calendar days: waiting for lender'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from case_events where kind='team_lender_response_confirmed'",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from opportunities where stage='new' and seller_id=$1",
          [seller],
        )
      ).rows.length,
      2,
    );
    assert.equal(
      (await db.query("select * from verifications")).rows.length,
      0,
    );
    assert.equal((await db.query("select * from outbox")).rows.length, 0);
    // The assigned seller now shares case mail; this does not grant team administration.
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: seller, aal: "aal2" }),
    ]);
    await db.exec("set role authenticated");
    assert.equal(
      (
        await db.query(
          "select * from conversations where submission_id is not null",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from gmail_team_members")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "select gmail_register_team('x@example.com','X','seller','internal',null,$1)",
        [admin],
      ),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: stranger, aal: "aal2" }),
    ]);
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select * from conversations")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("live Gmail team mail preserves campaigns and waits, and an unassociated team thread never matches a customer", async (t) => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://team-fixture.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
    GMAIL_HISTORY_ENABLED: "true",
    GOOGLE_OAUTH_ORGANIZATIONS: JSON.stringify([
      {
        id: "fixture",
        domain: "example.com",
        clientId: "fixture",
        clientSecret: "fixture",
      },
    ]),
  };
  const prior = Object.fromEntries(
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, env);
  const account = {
    id: randomUUID(),
    email: "owner@example.com",
    organization: "fixture",
    status: "connected",
  };
  const conversation = {
    id: randomUUID(),
    opportunity_id: randomUUID(),
    area: "seller",
  };
  let associated = true,
    stored = 0,
    notified = 0;
  const updates: any[] = [];
  t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({
    token: "fixture-access",
  }));
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
          input instanceof Request ? input : new Request(input, init),
        url = new URL(request.url);
      const body = request.method === "GET" ? null : await request.json();
      if (url.hostname === "gmail.googleapis.com")
        return Response.json({
          id: randomUUID(),
          threadId: "team-thread",
          internalDate: String(Date.now()),
          labelIds: ["INBOX"],
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "Valentina <valentina@example.com>" },
              { name: "To", value: account.email },
              { name: "Subject", value: "Team update" },
            ],
            body: {
              data: Buffer.from("Personal team update").toString("base64url"),
            },
          },
        });
      const table = url.pathname.split("/").at(-1);
      if (table === "mail_accounts") return Response.json(account);
      if (table === "mail_credentials")
        return Response.json({
          encrypted_refresh_token: encrypt("fixture-refresh"),
        });
      if (table === "gmail_team_members")
        return Response.json([{ email: "valentina@example.com" }]);
      if (table === "gmail_archive_messages")
        return Response.json({ id: randomUUID() });
      if (
        table === "gmail_associate_continuous" ||
        table === "gmail_record_reply" ||
        table === "gmail_process_live_reply" ||
        table === "gmail_track_live_wait"
      )
        return Response.json(null);
      if (table === "gmail_link_message") {
        if (!associated) return Response.json(null);
        stored++;
        return Response.json(randomUUID());
      }
      if (table === "gmail_saved_attachments") return Response.json([]);
      if (table === "gmail_thread_links")
        return Response.json({ opportunity_id: conversation.opportunity_id });
      if (table === "conversations") {
        if (request.method === "PATCH") {
          updates.push(body);
          return Response.json(null);
        }
        return Response.json(associated ? conversation : null);
      }
      if (table === "messages") {
        updates.push(body);
        return new Response(null, { status: 204 });
      }
      if (table === "opportunities")
        return Response.json({
          contact_id: randomUUID(),
          seller_id: randomUUID(),
          closer_id: null,
          handed_off_at: null,
        });
      if (table === "notify_user") {
        notified++;
        assert.equal(body.title_text, "New team message received");
        return Response.json(null);
      }
      throw new Error(`Unexpected team mail request: ${table}`);
    },
  );
  try {
    await syncMessage(account.id, "first");
    assert.equal(stored, 1);
    assert.equal(notified, 1);
    assert.ok(updates.every((u) => u.needs_attention === undefined));
    associated = false;
    await syncMessage(account.id, "second");
    assert.equal(stored, 1);
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
