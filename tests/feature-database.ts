import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
export async function featureDatabase() {
  const db = new PGlite();
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
  const users = {
    admin: randomUUID(),
    seller: randomUUID(),
    outsider: randomUUID(),
    closer: randomUUID(),
  };
  for (const [key, id] of Object.entries(users)) {
    await db.query("insert into auth.users values($1,$2)", [
      id,
      `${key}@team.test`,
    ]);
    await db.query(
      "insert into profiles(id,name,email,role) values($1,$2,$3,$4)",
      [
        id,
        key,
        `${key}@team.test`,
        key === "admin" ? "superadmin" : key === "closer" ? "closer" : "seller",
      ],
    );
  }
  async function asUser(id: string, aal = "aal2") {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, aal }),
    ]);
    await db.exec("set role authenticated");
  }
  async function command(kind: string, payload: object, key = randomUUID()) {
    return (
      await db.query<{ result: { id: string } }>(
        "select crm_command($1,$2,$3) result",
        [kind, payload, key],
      )
    ).rows[0].result;
  }
  return { db, users, asUser, command };
}
