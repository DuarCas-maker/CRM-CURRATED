import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedConnectSession } from "../src/lib/server/mail-accounts/composio-connect/http";
import { ConnectError } from "../src/lib/composio-connect";
test("HTTP session consumes SDK-verified claims and rechecks the current exact profile", async () => {
  const id = randomUUID(),
    sid = randomUUID(),
    now = Date.now();
  let claims: Record<string, unknown> = {
      sub: id,
      session_id: sid,
      aal: "aal2",
      role: "authenticated",
      exp: Math.floor(now / 1000) + 600,
    },
    profile: Record<string, unknown> = {
      id,
      active: true,
      role: "superadmin",
      mail_authorization_revision: 3,
    },
    calls = 0,
    error = false;
  const query = {
    select() {
      return query;
    },
    eq(column: string, value: string) {
      assert.equal(column, "id");
      assert.equal(value, id);
      return query;
    },
    single: async () => ({ data: profile, error: null }),
  };
  const db = {
    auth: {
      getClaims: async () => {
        calls++;
        return error
          ? { data: null, error: { message: "private-auth-detail" } }
          : { data: { claims }, error: null };
      },
    },
    from: (table: string) => {
      assert.equal(table, "profiles");
      return query;
    },
  } as unknown as SupabaseClient;
  const good = await verifiedConnectSession(db, id, now);
  assert.equal(good.session_id, sid);
  assert.equal(good.authorization_revision, 3);
  assert.equal(calls, 1);
  const baseClaims = { ...claims },
    baseProfile = { ...profile };
  for (const change of [
    () => {
      claims.sub = randomUUID();
    },
    () => {
      delete claims.session_id;
    },
    () => {
      claims.aal = "aal1";
    },
    () => {
      claims.role = "service_role";
    },
    () => {
      claims.exp = Math.floor(now / 1000) - 1;
    },
    () => {
      profile.active = false;
    },
    () => {
      profile.role = "seller";
    },
    () => {
      profile.id = randomUUID();
    },
    () => {
      error = true;
    },
  ]) {
    claims = { ...baseClaims };
    profile = { ...baseProfile };
    error = false;
    change();
    await assert.rejects(
      verifiedConnectSession(db, id, now),
      (e: unknown) =>
        e instanceof ConnectError &&
        e.code === "CONNECT_FORBIDDEN" &&
        !e.message.includes("private-auth-detail"),
    );
  }
});
