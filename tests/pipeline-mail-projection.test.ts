import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { featureDatabase } from "./feature-database";
import { installBrandDelivery } from "./fixtures/pipeline-os-s02-brand-delivery";

const root = "docs/specs/pipeline-os-load-recovery-20261122/database/";
const baseline = await readFile(root + "baseline-function.sql", "utf8");
const candidate =
  process.env.PROJECTION_COMPARE_BASELINE === "1"
    ? baseline
    : await readFile(root + "function.sql", "utf8");
type Fixture = Awaited<ReturnType<typeof featureDatabase>>;
type VisibleConversation = {
  id: string;
  subject: string | null;
  submission_id: string | null;
  process_id: string | null;
  can_reply: boolean;
};

async function fixture(singleConversation = false) {
  const caseCount = singleConversation ? 800 : 200;
  const f = await featureDatabase();
  try {
    await installBrandDelivery(f, false);
    await f.db.exec(baseline);
    // Same current public permission helpers as production (055), after local foundations.
    await f.db
      .exec(`create or replace function public.can_case(case_id uuid) returns boolean
      language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.opportunities o where o.id=case_id
      and (o.email_qualified_at is not null or o.historical_approved_at is not null)
      and (public.current_app_role() in ('superadmin','seller_admin','closer_admin')
        or (public.current_app_role()='seller' and o.seller_id=auth.uid())
        or (public.current_app_role()='closer' and o.closer_id=auth.uid()))) $$;`);
    await f.db
      .exec(`insert into companies(id,name) values(md5('projection-company')::uuid,'Projection fixture');
      insert into contacts(id,company_id,email,name,verification) values(md5('projection-contact')::uuid,
      md5('projection-company')::uuid,'projection@fixture.test','Fixture','valid');`);
    await f.db.query(
      `insert into mail_accounts(id,email,organization,owner_id)
      values(md5('projection-account')::uuid,'sender@fixture.test','Fixture',$1)`,
      [f.users.seller],
    );
    await f.db.query(
      `insert into opportunities(id,contact_id,company_id,company,seller_id,closer_id,
      handed_off_at,historical_approved_at,archived_at)
      select md5('projection-case-'||g)::uuid,md5('projection-contact')::uuid,
        md5('projection-company')::uuid,'Fixture '||g,$1::uuid,
        case when g%4=0 then null else $2::uuid end,
        case when g%4=0 then null else '2026-01-02'::timestamptz end,
        case when g%13=0 then null else '2026-01-01'::timestamptz end,
        case when g%17=0 then '2026-02-01'::timestamptz end
      from generate_series(1,${caseCount}) g`,
      [f.users.seller, f.users.closer],
    );
    await f.db
      .exec(`update opportunities set email_qualified_at=null where historical_approved_at is null;
      insert into conversations(id,opportunity_id,account_id,gmail_thread_id,subject,area)
      select md5('projection-conv-'||g||'-'||kind)::uuid,md5('projection-case-'||g)::uuid,
        md5('projection-account')::uuid,'thread-'||g||'-'||kind,'Hidden header '||g,
        case when kind=2 then 'closer'::case_area else 'seller'::case_area end
      from generate_series(1,${caseCount}) g cross join ${singleConversation ? "generate_series(3,3)" : "generate_series(1,4)"} kind;
      insert into messages(id,conversation_id,gmail_message_id,direction,sender,body,sent_at,status,participants,internet_message_id)
      select md5('projection-msg-'||g||'-'||kind||'-'||n)::uuid,
        md5('projection-conv-'||g||'-'||kind)::uuid,'message-'||g||'-'||kind||'-'||n,
        case when n%2=0 then 'outbound' else 'inbound' end,'client@fixture.test','Fictional body',
        case when n=1 then '2026-01-01'::timestamptz else '2026-01-03'::timestamptz end,
        case when n%2=0 then 'sent' else 'received' end,
        '[{"email":"recipient@fixture.test","role":"to"}]'::jsonb,
        'header-'||g||'-'||kind||'-'||n
      from generate_series(1,${caseCount}) g cross join ${singleConversation ? "generate_series(3,3)" : "generate_series(3,4)"} kind
        cross join generate_series(1,3) n;
      update messages set area='general' where gmail_message_id like '%-4-1';
      insert into gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,subject,
        sent_at,direction,nature,participants,encrypted_payload)
      select md5('projection-archive-'||g)::uuid,md5('projection-account')::uuid,
        'archive-'||g,'thread-'||g||'-4','Safe archived subject','2026-01-01','inbound',
        'personal','[]','fictional' from generate_series(1,${caseCount}) g;
      update messages m set archive_message_id=md5('projection-archive-'||g)::uuid
        from generate_series(1,${caseCount}) g where m.gmail_message_id='message-'||g||'-4-1';
      insert into outbox(account_id,opportunity_id,conversation_id,to_email,subject,body,area,message_id_header,request_key)
      select md5('projection-account')::uuid,md5('projection-case-'||g)::uuid,
        md5('projection-conv-'||g||'-3')::uuid,'client@fixture.test','Safe seller subject','Fictional',
        'seller','header-'||g||'-3-1','projection-outbox-'||g from generate_series(1,${caseCount}) g;
      analyze public.conversations;analyze public.messages;analyze public.opportunities;`);
    await f.db
      .exec(`insert into financing_processes(id,opportunity_id,sequence_number,started_at,classification,label)
      select md5('projection-process-'||g)::uuid,md5('projection-case-'||g)::uuid,
        1,'2026-01-02','active','Fictional process' from generate_series(1,${caseCount}) g;
      insert into lenders(id,name,email,channel) values(md5('projection-lender')::uuid,
        'Fictional lender','lender@fixture.test','email');`);
    await f.db.query(
      `insert into submissions(id,opportunity_id,lender_id,closer_id,channel,
      next_action,next_action_at,process_id)
      select md5('projection-submission-'||g)::uuid,md5('projection-case-'||g)::uuid,
        md5('projection-lender')::uuid,$1,'email','Fixture','2026-01-03',
        md5('projection-process-'||g)::uuid from generate_series(1,${caseCount}) g`,
      [f.users.closer],
    );
    await f.db
      .exec(`update conversations c set process_id=md5('projection-process-'||g)::uuid
      from generate_series(1,${caseCount}) g where c.opportunity_id=md5('projection-case-'||g)::uuid;
      update conversations c set submission_id=md5('projection-submission-'||g)::uuid
      from generate_series(1,${caseCount}) g where c.gmail_thread_id='thread-'||g||'-2';`);
    return f;
  } catch (e) {
    await f.db.close();
    throw e;
  }
}

async function metadata(f: Fixture) {
  await f.db.exec("reset role");
  return (
    await f.db
      .query(`select p.oid,p.proowner,p.proacl,p.prosecdef,p.provolatile,
    p.proconfig,p.prorettype,p.proretset,p.proargtypes,p.proallargtypes,p.proargmodes,p.proargnames,
    (select md5(string_agg(pg_get_viewdef(c.oid,false),'|' order by c.oid))
      from pg_class c where c.relkind='v' and c.relnamespace='public'::regnamespace) views,
    (select md5(string_agg(pg_get_expr(polqual,polrelid)||coalesce(pg_get_expr(polwithcheck,polrelid),''),'|' order by oid))
      from pg_policy) policies
    from pg_proc p where p.oid='s01_i02.visible_conversations()'::regprocedure`)
  ).rows;
}

test("visible mail projection preserves SQL results, grants and redaction for every actor", async (t) => {
  const f = await fixture();
  try {
    const originalMetadata = await metadata(f);
    for (const [role, user, aal] of [
      ["admin", f.users.admin, "aal2"],
      ["seller", f.users.seller, "aal2"],
      ["closer", f.users.closer, "aal2"],
      ["outsider", f.users.outsider, "aal2"],
      ["missing_mfa", f.users.admin, "aal1"],
    ]) {
      await t.test(role, async () => {
        await f.db.exec("reset role");
        await f.db.exec(baseline);
        await f.asUser(user, aal);
        const before = (
          await f.db.query<VisibleConversation>(
            "select * from mail_conversations_visible order by id",
          )
        ).rows;
        await f.db.exec("reset role");
        await f.db.exec(candidate);
        await f.asUser(user, aal);
        const after = (
          await f.db.query<VisibleConversation>(
            "select * from mail_conversations_visible order by id",
          )
        ).rows;
        assert.deepEqual(after, before);
        if (role === "outsider" || role === "missing_mfa")
          assert.equal(after.length, 0);
        else assert(after.length > 0);
        if (role === "closer" || role === "admin") {
          assert(after.some((r) => r.submission_id !== null));
          assert(after.some((r) => r.process_id !== null));
        }
        if (role === "seller") {
          assert(after.some((r) => r.subject === "Safe seller subject"));
          assert(after.some((r) => r.subject === "Safe archived subject"));
          assert(after.some((r) => r.can_reply === true));
          assert(
            after
              .filter((r) => r.can_reply === false)
              .every(
                (r) =>
                  !String(r.subject).startsWith("Hidden header") &&
                  r.submission_id === null &&
                  r.process_id === null,
              ),
          );
        }
      });
    }
    for (const role of ["seller_admin", "closer_admin"]) {
      await t.test(role, async () => {
        await f.db.exec("reset role");
        await f.db.query("update profiles set role=$1 where id=$2", [
          role,
          f.users.outsider,
        ]);
        await f.db.exec(baseline);
        await f.asUser(f.users.outsider);
        const before = (
          await f.db.query(
            "select * from mail_conversations_visible order by id",
          )
        ).rows;
        await f.db.exec("reset role");
        await f.db.exec(candidate);
        await f.asUser(f.users.outsider);
        const after = (
          await f.db.query(
            "select * from mail_conversations_visible order by id",
          )
        ).rows;
        assert.deepEqual(after, before);
        assert(after.length > 0);
        await f.db.exec("reset role");
        await f.db.query("update profiles set role='seller' where id=$1", [
          f.users.outsider,
        ]);
      });
    }
    await t.test("inactive and anonymous remain denied", async () => {
      await f.db.exec("reset role");
      await f.db.query("update profiles set active=false where id=$1", [
        f.users.admin,
      ]);
      await f.asUser(f.users.admin);
      assert.equal(
        (await f.db.query("select * from mail_conversations_visible")).rows
          .length,
        0,
      );
      await f.db.exec("reset role;set role anon");
      await assert.rejects(
        f.db.query("select * from mail_conversations_visible"),
        /permission denied/,
      );
      await f.db.exec("reset role");
      await f.db.query("update profiles set active=true where id=$1", [
        f.users.admin,
      ]);
    });
    assert.deepEqual(await metadata(f), originalMetadata);
    await f.db.exec(baseline);
    assert.deepEqual(await metadata(f), originalMetadata);
    await f.db.exec(candidate);
    assert.deepEqual(await metadata(f), originalMetadata);
  } finally {
    await f.db.close();
  }
});

test("permission evaluations are bounded by cases instead of conversations and messages", async () => {
  const f = await fixture();
  try {
    const original = (
      await f.db.query<{ sql: string }>(
        "select pg_get_functiondef('public.can_area(uuid,case_area)'::regprocedure) sql",
      )
    ).rows[0].sql;
    await f.db.exec(
      original.replace(
        "FUNCTION public.can_area(",
        "FUNCTION public.projection_original_can_area(",
      ),
    );
    await f.db.exec(`create temporary sequence projection_permission_calls;
      create or replace function public.can_area(case_id uuid,area public.case_area) returns boolean
      language plpgsql stable security definer set search_path='' as $$ begin
        perform nextval('pg_temp.projection_permission_calls');
        return public.projection_original_can_area(case_id,area);
      end $$;`);
    const counts = [];
    for (const sql of [baseline, candidate]) {
      await f.db.exec("reset role");
      await f.db.exec(sql);
      await f.db.exec(
        "alter sequence pg_temp.projection_permission_calls restart with 1",
      );
      await f.asUser(f.users.admin);
      await f.db.query("select * from mail_conversations_visible");
      await f.db.exec("reset role");
      counts.push(
        Number(
          (
            await f.db.query<{ n: number }>(
              "select currval('pg_temp.projection_permission_calls') n",
            )
          ).rows[0].n,
        ),
      );
    }
    assert(counts[1] <= 200 * 4, JSON.stringify(counts));
    assert(counts[0] > counts[1] * 2, JSON.stringify(counts));
    console.info(
      "permission_evaluations",
      JSON.stringify({ baseline: counts[0], candidate: counts[1] }),
    );
  } finally {
    await f.db.close();
  }
});

test("guarded SQL release and rollback preserve every pg_proc attribute except source", async () => {
  const f = await fixture();
  try {
    const migration = await readFile(
      root + "059_visible_mail_projection_performance.sql",
      "utf8",
    );
    const rollback = await readFile(root + "rollback.sql", "utf8");
    const snapshot = async () => {
      await f.db.exec("reset role");
      return (
        await f.db.query(
          "select to_jsonb(p) value from pg_proc p where oid='s01_i02.visible_conversations()'::regprocedure",
        )
      ).rows;
    };
    const original = await snapshot();
    await f.db.exec(migration);
    const optimized = await snapshot();
    assert.notDeepEqual(optimized, original);
    await assert.rejects(f.db.exec(migration), /MAIL_PROJECTION_SOURCE_DRIFT/);
    await f.db.exec("rollback");
    assert.deepEqual(await snapshot(), optimized);
    await f.db.exec(rollback);
    assert.deepEqual(await snapshot(), original);
    await f.db.exec(migration);
    assert.deepEqual(await snapshot(), optimized);
    await assert.rejects(
      f.db.exec(
        rollback.replace(
          /084a8b1c0f058da519cfbfa5e1e1f762/g,
          "00000000000000000000000000000000",
        ),
      ),
      /MAIL_PROJECTION_HASH_MISMATCH/,
    );
    await f.db.exec("rollback");
    assert.deepEqual(await snapshot(), optimized);
  } finally {
    await f.db.close();
  }
});

test("visible mail benchmark compares original and materialized permissions on fictional volume", async () => {
  const f = await fixture(true);
  try {
    const samples = [];
    for (const [version, sql] of [
      ["baseline", baseline],
      ["candidate", candidate],
    ]) {
      await f.db.exec("reset role");
      await f.db.exec(sql);
      await f.asUser(f.users.admin);
      const times = [];
      let rows = 0;
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        const result = await f.db.query(
          "select * from mail_conversations_visible order by id",
        );
        times.push(Math.round(performance.now() - start));
        rows = result.rows.length;
      }
      samples.push({ version, rows, ms: times });
    }
    assert.equal(samples[0].rows, samples[1].rows);
    const directory = ".local/pipeline-os-load-recovery-20261122/database";
    await mkdir(directory, { recursive: true });
    await writeFile(
      directory + "/local-benchmark.json",
      JSON.stringify(
        {
          runtime: "PGlite",
          fictional: true,
          cases: 800,
          conversations: 800,
          messages: 2400,
          samples,
        },
        null,
        2,
      ) + "\n",
    );
    console.info("projection_benchmark", JSON.stringify(samples));
  } finally {
    await f.db.close();
  }
});
