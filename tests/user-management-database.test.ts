import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

test("users: migration preserves core; metadata, access, private versions, service grants and rollback are enforced", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      grant usage on schema public,auth,storage to authenticated,anon,service_role;`);
    for (const file of (await readdir("supabase/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const roles = [
      "superadmin",
      "superadmin",
      "seller",
      "seller_admin",
      "closer",
      "closer_admin",
    ];
    const ids = roles.map(() => randomUUID());
    for (const [index, id] of ids.entries()) {
      await db.query("insert into auth.users values($1,$2)", [
        id,
        `person${index}@example.test`,
      ]);
      await db.query(
        "insert into profiles(id,name,email,role) values($1,$2,$3,$4)",
        [id, `Person ${index}`, `person${index}@example.test`, roles[index]],
      );
    }
    await db.exec(
      await readFile(
        "docs/specs/user-management/migrations/054_user_management.sql",
        "utf8",
      ),
    );
    async function asUser(id: string, aal = "aal2") {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: id, aal }),
      ]);
      await db.exec("set role authenticated");
    }
    async function asService() {
      await db.exec("reset role;set role service_role");
    }
    for (const id of ids.slice(2)) {
      await asUser(id);
      await assert.rejects(
        db.query("select user_management_list('',0)"),
        /USER_FORBIDDEN/,
      );
      await assert.rejects(
        db.query("select * from user_private_fields"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select user_management_private_read($1,$2)", [id, id]),
        /permission denied/,
      );
      await assert.rejects(
        db.query(
          "select user_management_access($1,'superadmin',true,'seller',true)",
          [id],
        ),
        /USER_FORBIDDEN/,
      );
    }
    await asUser(ids[0], "aal1");
    await assert.rejects(
      db.query("select user_management_list('',0)"),
      /USER_FORBIDDEN/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select user_management_list('',0)"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from user_private_fields"),
      /permission denied/,
    );
    await asUser(ids[0]);
    await assert.rejects(
      db.query("select * from user_private_fields"),
      /permission denied/,
    );
    for (const sql of [
      "insert into user_private_fields(user_id,encrypted_text,version,updated_by) values($1,'fixture',1,$1)",
      "update user_private_fields set encrypted_text='fixture' where user_id=$1",
      "delete from user_private_fields where user_id=$1",
    ])
      await assert.rejects(db.query(sql, [ids[0]]), /permission denied/);
    await assert.rejects(
      db.query("select user_management_private_write($1,$2,'cipher',0)", [
        ids[0],
        ids[2],
      ]),
      /permission denied/,
    );
    const list = await db.query<{ value: { items: unknown[]; total: number } }>(
      "select user_management_list('',0) value",
    );
    assert.equal(list.rows[0].value.total, 6);
    assert.equal(list.rows[0].value.items.length, 6);
    await db.exec("reset role;begin");
    for (let index = 0; index < 27; index++) {
      const id = randomUUID();
      await db.query("insert into auth.users values($1,$2)", [
        id,
        `paged${index}@example.test`,
      ]);
      await db.query(
        "insert into profiles(id,name,email,role) values($1,$2,$3,'seller')",
        [
          id,
          `Paged ${String(index).padStart(2, "0")}`,
          `paged${index}@example.test`,
        ],
      );
    }
    await asUser(ids[0]);
    const pages = [];
    for (const page of [0, 1])
      pages.push(
        (
          await db.query<{ value: { items: { id: string }[]; total: number } }>(
            "select user_management_list('Paged',$1) value",
            [page],
          )
        ).rows[0].value,
      );
    assert.equal(pages[0].total, 27);
    assert.equal(pages[0].items.length, 25);
    assert.equal(pages[1].items.length, 2);
    assert.equal(
      new Set(pages.flatMap((page) => page.items.map((item) => item.id))).size,
      27,
    );
    await db.exec("reset role;rollback");
    await asUser(ids[0]);
    await assert.rejects(
      db.query(
        "select user_management_access($1,'seller',false,'superadmin',true)",
        [ids[0]],
      ),
      /USER_OWN_ACCESS/,
    );
    await db.query(
      "select user_management_access($1,'closer',false,'seller',true)",
      [ids[2]],
    );
    await assert.rejects(
      db.query(
        "select user_management_access($1,'seller',true,'seller',true)",
        [ids[2]],
      ),
      /USER_CONFLICT/,
    );
    await db.query(
      "select user_management_access($1,'seller',true,'closer',false)",
      [ids[2]],
    );
    await asService();
    await assert.rejects(
      db.query("select user_management_private_read($1,$2)", [
        ids[0],
        randomUUID(),
      ]),
      /USER_NOT_FOUND/,
    );
    await assert.rejects(
      db.query("select user_management_private_read($1,$2)", [ids[2], ids[2]]),
      /USER_FORBIDDEN/,
    );
    const initial = await db.query<{
      value: { encrypted_text: null; version: number };
    }>("select user_management_private_read($1,$2) value", [ids[0], ids[2]]);
    assert.deepEqual(initial.rows[0].value, {
      encrypted_text: null,
      version: 0,
    });
    await db.query(
      "select user_management_private_write($1,$2,'fixture-ciphertext',0)",
      [ids[0], ids[2]],
    );
    await assert.rejects(
      db.query("select user_management_private_write($1,$2,'stale',0)", [
        ids[1],
        ids[2],
      ]),
      /USER_CONFLICT/,
    );
    await asUser(ids[0]);
    const meta = (
      await db.query<{
        value: {
          items: { has_private_text: boolean; private_version: number }[];
        };
      }>("select user_management_list('person2',0) value")
    ).rows[0].value;
    assert.equal(meta.items[0].has_private_text, true);
    assert.equal(meta.items[0].private_version, 1);
    assert(!JSON.stringify(meta).includes("fixture-ciphertext"));
    assert.equal(
      (
        await db.query<{ value: { total: number } }>(
          "select user_management_list('%',0) value",
        )
      ).rows[0].value.total,
      0,
    );
    await asService();
    await db.query("select user_management_private_write($1,$2,null,1)", [
      ids[0],
      ids[2],
    ]);
    await assert.rejects(
      db.query("select user_management_private_write($1,$2,'old',0)", [
        ids[0],
        ids[2],
      ]),
      /USER_CONFLICT/,
    );
    await db.query(
      "select user_management_password_audit($1,$2,'user_password_requested')",
      [ids[0], ids[2]],
    );
    await assert.rejects(
      db.query(
        "select user_management_password_audit($1,$2,'untrusted-action')",
        [ids[0], ids[2]],
      ),
      /USER_INVALID/,
    );
    const newId = randomUUID();
    await db.exec("reset role");
    await db.query("insert into auth.users values($1,'new@example.test')", [
      newId,
    ]);
    await asService();
    for (let i = 0; i < 2; i++)
      await db.query(
        "select user_management_finish_create($1,$2,'New Person','new@example.test','seller')",
        [ids[0], newId],
      );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from audit_log where action='user_created' and entity_id=$1",
          [newId],
        )
      ).rows[0].n,
      1,
    );
    const audit = JSON.stringify(
      (await db.query("select metadata from audit_log")).rows,
    );
    assert(!audit.includes("fixture-ciphertext"));
    assert(!audit.includes("password"));
    await db.query("update profiles set active=false where id=$1", [ids[0]]);
    await asUser(ids[0]);
    await assert.rejects(
      db.query("select user_management_list('',0)"),
      /USER_FORBIDDEN/,
    );
    await asService();
    await assert.rejects(
      db.query("select user_management_private_read($1,$2)", [ids[0], ids[2]]),
      /USER_FORBIDDEN/,
    );
    await db.exec("reset role");
    await db.exec(
      await readFile(
        "docs/specs/user-management/migrations/054_user_management.rollback.sql",
        "utf8",
      ),
    );
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from profiles"))
        .rows[0].n,
      7,
    );
    await db.exec(
      await readFile(
        "docs/specs/user-management/migrations/054_user_management.sql",
        "utf8",
      ),
    );
    await asUser(ids[1]);
    assert.equal(
      (
        await db.query<{ value: { total: number } }>(
          "select user_management_list('',0) value",
        )
      ).rows[0].value.total,
      7,
    );
  } finally {
    await db.close();
  }
});
