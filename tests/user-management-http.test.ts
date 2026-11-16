import test from "node:test";
import assert from "node:assert/strict";
import {
  userManagementResponse,
  type UserManagementDependencies,
} from "../src/lib/server/user-management-http";
import { HttpError } from "../src/lib/server/supabase";
import { userCommandSchema } from "../src/lib/user-management";

const target = "a0000000-0000-4000-8000-000000000002";
function fixture(role = "superadmin", active = true) {
  const calls: unknown[] = [];
  const dependencies: UserManagementDependencies = {
    authenticate: async () =>
      ({ profile: { id: target, name: "Fixture", role, active } }) as never,
    list: async (_context, query) => {
      calls.push(query);
      return { items: [], total: 0, page: 0 };
    },
    execute: async (_context, command) => {
      calls.push(command);
      return { ok: true };
    },
  };
  return { calls, dependencies };
}
const request = (body: unknown, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/users", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("users HTTP: all commands deny other roles/inactive admins before any operation; auth/MFA failures remain denied", async () => {
  for (const [role, active] of [
    ["seller", true],
    ["seller_admin", true],
    ["closer", true],
    ["closer_admin", true],
    ["superadmin", false],
  ] as const) {
    const f = fixture(role, active);
    for (const r of [
      new Request("http://localhost:3000/api/users"),
      request({ action: "reveal", user_id: target }),
    ]) {
      const response = await userManagementResponse(r, f.dependencies);
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    }
    assert.equal(f.calls.length, 0);
  }
  for (const code of [401, 403]) {
    const f = fixture();
    f.dependencies.authenticate = async () => {
      throw new HttpError(code, "Fixture denied");
    };
    assert.equal(
      (
        await userManagementResponse(
          request({ action: "reveal", user_id: target }),
          f.dependencies,
        )
      ).status,
      code,
    );
  }
});
test("users HTTP: origin, schema, query, JSON and streamed body limits reject malformed requests without mutation", async () => {
  const f = fixture();
  for (const [req, status] of [
    [
      request(
        { action: "reveal", user_id: target },
        "https://untrusted.invalid",
      ),
      403,
    ],
    [request({ action: "password", user_id: target, password: "short" }), 400],
    [request({ action: "reveal", user_id: target, unexpected: "x" }), 400],
    [
      request({
        action: "private_text",
        user_id: target,
        text: "x".repeat(4001),
        expected_version: 0,
      }),
      400,
    ],
    [
      request({
        action: "private_text",
        user_id: target,
        text: "x".repeat(40000),
        expected_version: 0,
      }),
      413,
    ],
    [new Request("http://localhost:3000/api/users?page=-1"), 400],
    [new Request("http://localhost:3000/api/users?page=0&page=1"), 400],
    [new Request("http://localhost:3000/api/users?extra=secret"), 400],
    [
      new Request("http://localhost:3000/api/users", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: "{",
      }),
      400,
    ],
  ] as const)
    assert.equal(
      (await userManagementResponse(req, f.dependencies)).status,
      status,
    );
  assert.equal(f.calls.length, 0);
});
test("users HTTP: valid creates return 201/no-store; passwords preserve whitespace and invalid fields are rejected", async () => {
  const f = fixture();
  const command = {
    action: "create",
    request_id: target,
    name: " Person ",
    email: "Person@example.test",
    role: "seller",
    password: "  test-pass-1234  ",
  };
  const r = await userManagementResponse(request(command), f.dependencies);
  assert.equal(r.status, 201);
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(f.calls[0], {
    ...command,
    name: "Person",
    email: "person@example.test",
  });
  assert(!JSON.stringify(await r.json()).includes(command.password));
  assert.equal(
    userCommandSchema.safeParse({ ...command, role: "custom_admin" }).success,
    false,
  );
  assert.equal(
    userCommandSchema.safeParse({ ...command, password: "x".repeat(129) })
      .success,
    false,
  );
  f.dependencies.execute = async () => {
    throw new Error("provider leaked fixture-secret");
  };
  const failure = await userManagementResponse(
    request({ action: "reveal", user_id: target }),
    f.dependencies,
  );
  assert.equal(failure.status, 500);
  assert(!(await failure.text()).includes("fixture-secret"));
});
