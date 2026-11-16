import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  executeUserCommand,
  listManagedUsers,
} from "../src/lib/server/user-management";
import type { Profile } from "../src/lib/domain";
import type { UserCommand } from "../src/lib/user-management";
import { encrypt, decrypt } from "../src/lib/server/crypto";

// This isolated test process uses a synthetic key; no real configuration is read.
process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const actor: Profile = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Fixture Admin",
  email: "admin@example.test",
  role: "superadmin",
  active: true,
};
const target = "a0000000-0000-4000-8000-000000000002";
const creation = {
  action: "create",
  request_id: target,
  name: "Fixture User",
  email: "new@example.test",
  role: "seller",
  password: "Synthetic-test-pass-123",
} as const;
function fixture() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let user: User | null = null,
    exists = false,
    ciphertext: string | null = null;
  let rpcError = "",
    authError: { status: number; code?: string } | null = null,
    ambiguous = false;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (rpcError === name)
        return {
          data: null,
          error: { message: "database detail with fixture-secret" },
        };
      if (name === "user_management_finish_create")
        return { data: target, error: null };
      if (name === "user_management_private_read")
        return {
          data: { encrypted_text: ciphertext, version: 1 },
          error: null,
        };
      if (name === "user_management_private_write") {
        ciphertext = args.p_ciphertext as string | null;
        return { data: 2, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            calls.push({ name: table, args: {} });
            return {
              data: exists ? { email: creation.email } : null,
              error: null,
            };
          },
        }),
      }),
    }),
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user },
          error: user ? null : { status: 404 },
        }),
        createUser: async (args: Record<string, unknown>) => {
          calls.push({ name: "auth.create", args });
          if (authError && !ambiguous)
            return { data: { user: null }, error: authError };
          user = {
            id: args.id,
            email: args.email,
            app_metadata: args.app_metadata,
          } as User;
          return {
            data: { user: ambiguous ? null : user },
            error: ambiguous ? { status: 503 } : null,
          };
        },
        updateUserById: async (id: string, args: Record<string, unknown>) => {
          calls.push({ name: "auth.password", args: { id, ...args } });
          return { data: { user }, error: authError };
        },
      },
    },
  } as unknown as SupabaseClient;
  return {
    client,
    calls,
    options: { service: () => client },
    setExisting: () => {
      exists = true;
    },
    setRpcError: (name: string) => {
      rpcError = name;
    },
    setAuthError: (error: typeof authError) => {
      authError = error;
    },
    setAmbiguous: () => {
      ambiguous = true;
    },
    setCiphertext: (value: string) => {
      ciphertext = value;
    },
    setUser: (value: User) => {
      user = value;
    },
    cipher: () => ciphertext,
  };
}
test("users service: direct create confirms email, assigns stable ID, never emails, and replay does not update password/profile role", async () => {
  const f = fixture();
  assert.deepEqual(
    await executeUserCommand(f.client, actor, creation, f.options),
    { ok: true, id: target },
  );
  await executeUserCommand(
    f.client,
    actor,
    { ...creation, password: "Different-synthetic-pass" },
    f.options,
  );
  assert.equal(f.calls.filter((c) => c.name === "auth.create").length, 1);
  assert.equal(f.calls.filter((c) => c.name === "auth.password").length, 0);
  const args = f.calls.find((c) => c.name === "auth.create")!.args;
  assert.equal(args.id, target);
  assert.equal(args.email_confirm, true);
  assert(!JSON.stringify(args.app_metadata).includes(creation.password));
  assert(
    !JSON.stringify(
      f.calls.filter((c) => c.name.startsWith("user_management")),
    ).includes(creation.password),
  );
  await assert.rejects(
    executeUserCommand(
      f.client,
      actor,
      { ...creation, role: "superadmin" },
      f.options,
    ),
    /solicitud ya se utilizó/,
  );
});
test("users service: uncertain Auth and failed finalization reconcile without creating a second identity", async () => {
  for (const failure of ["auth", "database"]) {
    const f = fixture();
    if (failure === "auth") f.setAmbiguous();
    else f.setRpcError("user_management_finish_create");
    await assert.rejects(
      executeUserCommand(f.client, actor, creation, f.options),
    );
    f.setRpcError("");
    assert.deepEqual(
      await executeUserCommand(f.client, actor, creation, f.options),
      { ok: true, id: target },
    );
    assert.equal(f.calls.filter((c) => c.name === "auth.create").length, 1);
  }
});
test("users service: duplicate email, unrelated Auth ID, inactive and non-admin actors are rejected", async () => {
  const duplicate = fixture();
  duplicate.setExisting();
  await assert.rejects(
    executeUserCommand(duplicate.client, actor, creation, duplicate.options),
    /correo ya tiene/,
  );
  assert(!duplicate.calls.some((c) => c.name === "auth.create"));
  const unrelated = fixture();
  unrelated.setUser({
    id: target,
    email: creation.email,
    app_metadata: {},
  } as User);
  await assert.rejects(
    executeUserCommand(unrelated.client, actor, creation, unrelated.options),
    /solicitud ya se utilizó/,
  );
  for (const p of [
    { ...actor, active: false },
    { ...actor, role: "seller" as const },
  ]) {
    await assert.rejects(
      executeUserCommand({} as SupabaseClient, p, creation, {
        service: () => {
          throw new Error("MUST_NOT_CREATE_SERVICE");
        },
      }),
      /exclusivo/,
    );
  }
});
test("users service: private payload is encrypted, bound to target, versioned, clearable and tamper resistant", async () => {
  const f = fixture();
  const command: UserCommand = {
    action: "private_text",
    user_id: target,
    text: "Synthetic private memo",
    expected_version: 1,
  };
  await executeUserCommand(f.client, actor, command, f.options);
  assert(f.cipher());
  assert(!f.cipher()!.includes(command.text));
  assert.deepEqual(JSON.parse(decrypt(f.cipher()!)), {
    user_id: target,
    text: command.text,
  });
  assert.deepEqual(
    await executeUserCommand(
      f.client,
      actor,
      { action: "reveal", user_id: target },
      f.options,
    ),
    { text: command.text, version: 1 },
  );
  f.setCiphertext(
    encrypt(JSON.stringify({ user_id: actor.id, text: command.text })),
  );
  await assert.rejects(
    executeUserCommand(
      f.client,
      actor,
      { action: "reveal", user_id: target },
      f.options,
    ),
    /No se pudo abrir/,
  );
  f.setCiphertext("tampered");
  await assert.rejects(
    executeUserCommand(
      f.client,
      actor,
      { action: "reveal", user_id: target },
      f.options,
    ),
    /No se pudo abrir/,
  );
  await assert.rejects(
    executeUserCommand(f.client, actor, command, {
      ...f.options,
      seal: () => {
        throw new Error("fixture-secret");
      },
    }),
    /almacenamiento privado/,
  );
  await executeUserCommand(
    f.client,
    actor,
    { ...command, text: "" },
    f.options,
  );
  assert.equal(f.cipher(), null);
});
test("users service: password changes audit before/after Auth, do not send password to SQL and fail closed on missing audit", async () => {
  const f = fixture();
  await executeUserCommand(
    f.client,
    actor,
    { action: "password", user_id: target, password: creation.password },
    f.options,
  );
  assert.deepEqual(
    f.calls.map((c) => c.name),
    [
      "user_management_assert_actor",
      "user_management_password_audit",
      "auth.password",
      "user_management_password_audit",
    ],
  );
  assert(
    !JSON.stringify(f.calls.filter((c) => c.name !== "auth.password")).includes(
      creation.password,
    ),
  );
  const denied = fixture();
  denied.setRpcError("user_management_password_audit");
  await assert.rejects(
    executeUserCommand(
      denied.client,
      actor,
      { action: "password", user_id: target, password: creation.password },
      denied.options,
    ),
    /operación de usuarios/,
  );
  assert(!denied.calls.some((c) => c.name === "auth.password"));
  f.setAuthError({ status: 422, code: "weak_password" });
  await assert.rejects(
    executeUserCommand(
      f.client,
      actor,
      { action: "password", user_id: target, password: creation.password },
      f.options,
    ),
    /política de seguridad/,
  );
});
test("users service: lists validate a metadata-only response and missing migration has an activation error", async () => {
  const db = {
    rpc: async () => ({ data: { items: [], total: 0, page: 0 }, error: null }),
  } as unknown as SupabaseClient;
  assert.deepEqual(await listManagedUsers(db, { q: "", page: 0 }), {
    items: [],
    total: 0,
    page: 0,
  });
  const missing = {
    rpc: async () => ({
      data: null,
      error: { code: "PGRST202", message: "secret fixture DB details" },
    }),
  } as unknown as SupabaseClient;
  await assert.rejects(
    listManagedUsers(missing, { q: "", page: 0 }),
    /pendiente de activación/,
  );
});
