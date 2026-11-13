import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

const lit = (v: unknown) =>
  v === null ? "null" : `'${String(v).replaceAll("'", "''")}'`;
const json = (v: unknown) => lit(JSON.stringify(v)) + "::jsonb";

test(
  "mail review native PG15: production ownership, real contention, RLS and reversible additive DDL",
  {
    skip: process.env.PIPELINE_MAIL_REVIEW_PG15 !== "1",
    timeout: 180_000,
  },
  async (t) => {
    assert.equal(process.versions.node.split(".")[0], "22");
    const runtime = process.env.PIPELINE_MAIL_REVIEW_PGROOT;
    assert.ok(
      runtime,
      "Provide an explicitly provisioned official PG15 runtime",
    );
    const pgBin = join(resolve(runtime), "pgsql/bin");
    const runRoot = join(resolve(runtime), "runs", randomUUID());
    mkdirSync(runRoot, { recursive: true });
    const cluster = join(runRoot, "cluster");
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      SystemRoot: process.env.SystemRoot,
      COMSPEC: process.env.COMSPEC,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PATH: pgBin + ";" + process.env.SystemRoot + "\\System32",
      PGAPPNAME: "pipeline-mail-review-053-qa",
      PGCLIENTENCODING: "UTF8",
    };
    const bin = (name: string, args: string[], input?: string) =>
      execFileSync(join(pgBin, name + ".exe"), args, {
        input,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 12 * 1024 * 1024,
        stdio: name === "pg_ctl" ? "ignore" : ["pipe", "pipe", "pipe"],
      });
    const listener = createServer();
    await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
    const address = listener.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((r, reject) =>
      listener.close((e) => (e ? reject(e) : r())),
    );
    const args = [
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-U",
      "mail_review_owner",
      "-d",
      "postgres",
    ];
    const prefix =
      "set client_min_messages=warning;set statement_timeout='15s';set lock_timeout='5s';\n";
    const sql = (text: string) => {
      try {
        return bin("psql", args, prefix + text).trim();
      } catch (e) {
        throw new Error(String((e as { stderr?: string }).stderr ?? e));
      }
    };
    const value = (text: string) =>
      JSON.parse(sql(text).split(/\r?\n/).filter(Boolean).at(-1)!);
    const concurrent = (text: string): Promise<string> =>
      new Promise((resolve, reject) => {
        const child = spawn(join(pgBin, "psql.exe"), args, {
          env,
          windowsHide: true,
          stdio: "pipe",
        });
        let out = "",
          err = "";
        child.stdout.on("data", (c) => (out += c));
        child.stderr.on("data", (c) => (err += c));
        child.on("error", reject);
        child.on("close", (c) =>
          c === 0 ? resolve(out.trim()) : reject(new Error(err)),
        );
        child.stdin.end(prefix + text);
      });
    const users = {
      admin: randomUUID(),
      closer: randomUUID(),
      seller: randomUUID(),
      outsider: randomUUID(),
    };
    const ids = Object.fromEntries(
      [
        "contact",
        "case",
        "process",
        "other",
        "lender",
        "submission",
        "account",
        "conversation",
        "message",
        "requirement",
        "changed",
        "race",
      ].map((k) => [k, randomUUID()]),
    );
    const auth = (user = users.closer, aal = "aal2") =>
      `begin;set local role authenticated;set local request.jwt.claims=${lit(JSON.stringify({ sub: user, aal }))};`;
    const human = (call: string, user = users.closer, aal = "aal2") =>
      value(`${auth(user, aal)}select ${call};commit;`);
    const beginCall = (
      message: string,
      key = randomUUID(),
      retry = false,
      revision: number | null = null,
    ) =>
      `pipeline_mail_begin(${lit(message)},${lit(ids.process)},${lit(ids.submission)},${lit(key)},${retry},${revision ?? "null"})`;
    const proposal = {
      kind: "offer",
      amount: 50000,
      product: "MCA",
      term: "24 weeks",
      cost: "",
      frequency: "weekly",
      fees: "",
      expires_at: null,
      requirement: "",
      summary: "Fixture reviewed",
      task_title: "Review fixture",
      evidence: [{ field: "amount", quote: "$50,000" }],
    };
    const { evidence: _evidence, ...approved } = proposal;
    const approval = {
      ...approved,
      owner_id: users.closer,
      due_at: new Date(Date.now() + 86400000).toISOString(),
    };
    const approveCall = (
      r: { id: string; revision: number },
      key = randomUUID(),
      p = approval,
    ) =>
      `pipeline_mail_approve(${lit(r.id)},${r.revision},${lit(key)},${json(p)})`;
    const finish = (
      r: { id: string; analysis_key: string },
      p: unknown = proposal,
    ) => {
      sql(
        `begin;set local role service_role;select pipeline_mail_finish(${lit(r.id)},${lit(r.analysis_key)},${json(p)},null);commit;`,
      );
      return value(
        `select row_to_json(r) from pipeline_mail_reviews r where id=${lit(r.id)};`,
      );
    };
    const catalog = () =>
      sql(`select coalesce(jsonb_agg(to_jsonb(x) order by signature),'[]') from (
    select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl,pg_get_userbyid(p.proowner) owner
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','auth','s01_i02','brand_b1','brand_b2','composio_c1')
    and p.prokind='f' and p.proname not like 'pipeline_mail_%')x;`);
    let started = false;
    const checks: string[] = [];
    const check = async (name: string, fn: () => void | Promise<void>) =>
      t.test(name, async () => {
        await fn();
        checks.push(name);
      });
    let version = 0;
    try {
      bin("initdb", [
        "-D",
        cluster,
        "-U",
        "mail_review_owner",
        "--auth-local=trust",
        "--auth-host=trust",
        "--encoding=UTF8",
        "--locale=C",
      ]);
      bin("pg_ctl", [
        "-D",
        cluster,
        "-l",
        join(runRoot, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${port} -c unix_socket_directories=`,
        "-w",
        "start",
      ]);
      started = true;
      version = value("select current_setting('server_version_num')::int;");
      assert.ok(version >= 150000 && version < 160000);
      sql(`create role anon;create role authenticated;create role service_role bypassrls;create role supabase_admin superuser;
      create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated,anon,service_role;grant select on storage.objects to authenticated;`);
      const migrations = readdirSync("supabase/migrations")
        .filter((n) => /^\d{3}_.*\.sql$/.test(n))
        .sort();
      assert.equal(migrations.length, 47);
      sql(
        "set role supabase_admin;\n" +
          migrations
            .map((n) => readFileSync(join("supabase/migrations", n), "utf8"))
            .join("\n"),
      );
      const accepted = readFileSync(
        "docs/specs/pipeline-os/s02/release/abc-final/049_integrate_mail_identity_brands_and_bindings.sql",
        "utf8",
      );
      const start = accepted.indexOf(
          "-- Source docs/specs/pipeline-os/s02/integration/migrations/a-brand-foundation.local.sql",
        ),
        end = accepted.indexOf("do $af_check$");
      assert.ok(start > 0 && end > start);
      // Fresh synthetic materialization only, never the historical remote migration protocol.
      sql(
        "set role supabase_admin;begin;set local search_path=pg_catalog,public,pg_temp;\n" +
          accepted.slice(start, end) +
          "\ncommit;",
      );
      const before = catalog();
      const install = readFileSync(
        "docs/specs/pipeline-os/mail-review/migrations/053_pipeline_mail_review.sql",
        "utf8",
      );
      sql("set role supabase_admin;\n" + install);
      await check(
        "053 installs with supabase_admin ownership and leaves prior function definitions/ACL intact",
        () => {
          assert.equal(catalog(), before);
          assert.equal(
            value(
              "select count(*)::int from pg_proc where proname like 'pipeline_mail_%' and proowner='supabase_admin'::regrole;",
            ),
            5,
          );
          assert.equal(
            value(
              "select count(*)::int from pg_class where relname in ('pipeline_mail_reviews','pipeline_mail_requirements','pipeline_mail_review_attempts') and relrowsecurity;",
            ),
            3,
          );
        },
      );
      for (const [name, id] of Object.entries(users))
        sql(
          `insert into auth.users values(${lit(id)},${lit(name + "@fictional.test")});insert into profiles(id,name,email,role) values(${lit(id)},${lit(name)},${lit(name + "@fictional.test")},${lit(name === "admin" ? "superadmin" : name === "closer" ? "closer" : "seller")});`,
        );
      sql(`insert into contacts(id,email,verification) values(${lit(ids.contact)},'merchant@fictional.test','valid');
      insert into opportunities(id,contact_id,company,seller_id,closer_id,handed_off_at,stage) values(${lit(ids.case)},${lit(ids.contact)},'Fictional merchant',${lit(users.seller)},${lit(users.closer)},now(),'lenders');
      insert into financing_processes(id,opportunity_id,sequence_number,started_at,classification,label,state) values(${lit(ids.process)},${lit(ids.case)},1,now(),'active','Fixture','submitted'),(${lit(ids.other)},${lit(ids.case)},2,now(),'active','Other','submitted');
      insert into lenders(id,name,email,channel) values(${lit(ids.lender)},'Fixture','lender@fictional.test','email');
      insert into submissions(id,opportunity_id,lender_id,closer_id,channel,next_action,next_action_at,process_id) values(${lit(ids.submission)},${lit(ids.case)},${lit(ids.lender)},${lit(users.closer)},'email','Review',now(),${lit(ids.process)});
      insert into mail_accounts(id,email,organization,owner_id) values(${lit(ids.account)},'closer@fictional.test','fixture',${lit(users.closer)});
      insert into conversations(id,opportunity_id,account_id,gmail_thread_id,subject,area,process_id,submission_id) values(${lit(ids.conversation)},${lit(ids.case)},${lit(ids.account)},'fixture-thread','Fixture','closer',${lit(ids.process)},${lit(ids.submission)});`);
      for (const id of [ids.message, ids.requirement, ids.changed, ids.race])
        sql(
          `insert into messages(id,conversation_id,gmail_message_id,direction,sender,body,sent_at,status) values(${lit(id)},${lit(ids.conversation)},${lit(id)},'inbound','lender@fictional.test','MCA offer $50,000; provide AR aging',now(),'received');`,
        );
      let ready: { id: string; revision: number };
      await check(
        "concurrent begin across two physical sessions permits exactly one fresh analysis and zero commercial effects",
        async () => {
          const pair = await Promise.all(
            [1, 2].map(() =>
              concurrent(
                `${auth()}select ${beginCall(ids.message)};select pg_sleep(0.2);commit;`,
              ),
            ),
          );
          const rows = pair.map((s) =>
            JSON.parse(s.split(/\r?\n/).find((l) => l.startsWith("{"))!),
          );
          assert.equal(rows.filter((r) => r.fresh).length, 1);
          assert.equal(rows[0].review.id, rows[1].review.id);
          assert.equal(value("select count(*)::int from offers;"), 0);
          assert.equal(value("select count(*)::int from tasks;"), 0);
          ready = finish(rows[0].review);
        },
      );
      await check(
        "invalid owner, revision, amount and mismatched process produce no partial writes",
        () => {
          assert.throws(
            () =>
              human(
                approveCall(ready!, randomUUID(), {
                  ...approval,
                  owner_id: users.outsider,
                }),
              ),
            /MR_OWNER_INVALID/,
          );
          assert.throws(
            () => human(approveCall({ ...ready!, revision: 1 })),
            /MR_STALE/,
          );
          assert.throws(
            () =>
              human(
                approveCall(ready!, randomUUID(), { ...approval, amount: -1 }),
              ),
            /MR_INVALID/,
          );
          assert.throws(
            () =>
              human(
                `pipeline_mail_begin(${lit(ids.message)},${lit(ids.other)},${lit(ids.submission)},${lit(randomUUID())},false,null)`,
              ),
            /MR_ASSOCIATION_REQUIRED/,
          );
          assert.equal(value("select count(*)::int from offers;"), 0);
        },
      );
      await check(
        "concurrent same-key approval commits exactly one offer/task/activity/event and replays identical IDs",
        async () => {
          const key = randomUUID();
          const pair = await Promise.all(
            [1, 2].map(() =>
              concurrent(
                `${auth()}select ${approveCall(ready!, key)};select pg_sleep(0.2);commit;`,
              ),
            ),
          );
          const rows = pair.map((s) =>
            JSON.parse(s.split(/\r?\n/).find((l) => l.startsWith("{"))!),
          );
          assert.deepEqual(rows[0], rows[1]);
          for (const table of ["offers", "tasks", "case_events"])
            assert.equal(
              value(`select count(*)::int from ${table};`),
              1,
              table,
            );
          assert.equal(
            value(
              "select count(*)::int from activities where type='pipeline_mail_review';",
            ),
            1,
          );
          assert.equal(value("select count(*)::int from outbox;"), 0);
          assert.equal(
            value(
              `select to_json(state) from financing_processes where id=${lit(ids.process)};`,
            ),
            "submitted",
          );
        },
      );
      await check(
        "different-key competing approval has one winner and one MR_ALREADY_APPROVED without duplicates",
        async () => {
          const r = finish(human(beginCall(ids.race)).review);
          const result = await Promise.allSettled(
            [1, 2].map(() =>
              concurrent(
                `${auth()}select ${approveCall(r)};select pg_sleep(0.2);commit;`,
              ),
            ),
          );
          assert.equal(
            result.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert.match(
            String(
              (
                result.find(
                  (r) => r.status === "rejected",
                ) as PromiseRejectedResult
              ).reason,
            ),
            /MR_ALREADY_APPROVED/,
          );
          assert.equal(value("select count(*)::int from offers;"), 2);
          assert.equal(value("select count(*)::int from tasks;"), 2);
        },
      );
      await check(
        "requirement approval creates a requirement and task without an extra offer",
        () => {
          const r = finish(human(beginCall(ids.requirement)).review, {
            ...proposal,
            kind: "requirement",
            amount: null,
            requirement: "AR aging",
          });
          human(
            approveCall(r, randomUUID(), {
              ...approval,
              kind: "requirement",
              amount: null,
              requirement: "AR aging",
            } as unknown as typeof approval),
          );
          assert.equal(
            value("select count(*)::int from pipeline_mail_requirements;"),
            1,
          );
          assert.equal(value("select count(*)::int from offers;"), 2);
          assert.equal(value("select count(*)::int from tasks;"), 3);
        },
      );
      await check(
        "source changes block approval; explicit reanalysis archives old attempt and ignores a stale finish",
        () => {
          const old = human(beginCall(ids.changed)).review,
            r = finish(old);
          sql(
            `update messages set body='Changed fixture' where id=${lit(ids.changed)};`,
          );
          assert.throws(() => human(approveCall(r)), /MR_CONTEXT_CHANGED/);
          const retry = human(
            beginCall(ids.changed, randomUUID(), true, r.revision),
          ).review;
          finish(old, { ...proposal, amount: 1 });
          assert.equal(
            value(
              `select to_json(status) from pipeline_mail_reviews where id=${lit(retry.id)};`,
            ),
            "analyzing",
          );
          finish(retry);
          assert.equal(
            value("select count(*)::int from pipeline_mail_review_attempts;"),
            1,
          );
        },
      );
      await check(
        "integrated permission catalog denies seller/outsider/inactive/AAL1/anon and direct writes",
        () => {
          for (const user of [users.seller, users.outsider]) {
            assert.throws(
              () => human(`pipeline_mail_page(${lit(ids.case)},null)`, user),
              /MR_FORBIDDEN/,
            );
            for (const table of [
              "pipeline_mail_reviews",
              "pipeline_mail_requirements",
              "pipeline_mail_review_attempts",
            ])
              assert.equal(human(`count(*)::int from ${table}`, user), 0);
          }
          assert.throws(
            () => human(beginCall(ids.changed), users.closer, "aal1"),
            /MR_FORBIDDEN/,
          );
          sql(
            `update profiles set active=false where id=${lit(users.closer)};`,
          );
          assert.throws(() => human(beginCall(ids.changed)), /MR_FORBIDDEN/);
          sql(`update profiles set active=true where id=${lit(users.closer)};`);
          assert.throws(
            () =>
              sql(
                `${auth()}update pipeline_mail_reviews set status='ready';commit;`,
              ),
            /permission denied/,
          );
          assert.throws(
            () => sql(`set role anon;select * from pipeline_mail_reviews;`),
            /permission denied/,
          );
          assert.throws(
            () =>
              sql(
                `${auth()}select pipeline_mail_finish(${lit(ready!.id)},${lit(randomUUID())},null,null);commit;`,
              ),
            /permission denied/,
          );
        },
      );
      await check(
        "rollback preserves approved business effects and old catalog; reinstall succeeds",
        () => {
          sql(
            "set role supabase_admin;\n" +
              readFileSync(
                "docs/specs/pipeline-os/mail-review/migrations/053_pipeline_mail_review.rollback.sql",
                "utf8",
              ),
          );
          assert.equal(catalog(), before);
          assert.equal(value("select count(*)::int from offers;"), 2);
          assert.equal(value("select count(*)::int from tasks;"), 3);
          sql("set role supabase_admin;\n" + install);
          assert.equal(catalog(), before);
        },
      );
    } finally {
      if (started) bin("pg_ctl", ["-D", cluster, "-m", "fast", "-w", "stop"]);
      writeFileSync(
        join(runRoot, "receipt.json"),
        JSON.stringify(
          {
            protocol: "MAIL-REVIEW-053-PG15-r1",
            version,
            checks,
            clusterStopped: started,
            synthetic: true,
          },
          null,
          2,
        ),
      );
      console.log(
        JSON.stringify({
          nativePgVersion: version,
          passedChecks: checks.length,
          receipt: join(runRoot, "receipt.json"),
          clusterStopped: started,
        }),
      );
    }
  },
);
