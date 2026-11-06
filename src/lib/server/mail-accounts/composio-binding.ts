import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../../domain";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../supabase";
import {
  bindingMessages,
  bindingPageSchema,
  bindingResultSchema,
  parseBindingCommand,
  type BindingErrorCode,
  bindingExpected,
} from "../../composio-bindings";
import {
  verificationContextHash,
  verificationTargetSchema,
  verifyComposioBinding,
  type ComposioVerificationDependencies,
  type VerificationTiming,
} from "./composio-verifier";

export class ComposioBindingError extends HttpError {
  constructor(
    public readonly code: BindingErrorCode,
    status = 409,
  ) {
    super(status, bindingMessages[code].join(" / "));
  }
}
export function requireComposioAdmin(
  profile: Pick<Profile, "role" | "active">,
) {
  if (profile.role !== "superadmin" || profile.active !== true)
    throw new ComposioBindingError("C_BINDING_FORBIDDEN", 403);
}
function result<T>(r: {
  data: T;
  error: { code?: string; message?: string } | null;
}): T {
  if (!r.error) return r.data;
  const code = r.error.message as BindingErrorCode;
  if (Object.hasOwn(bindingMessages, code)) {
    const status =
      code === "C_BINDING_FORBIDDEN"
        ? 403
        : code === "C_BINDING_NOT_FOUND"
          ? 404
          : code === "C_BINDING_INVALID_INPUT"
            ? 400
            : code === "C_BINDING_UNAVAILABLE"
              ? 503
              : 409;
    throw new ComposioBindingError(code, status);
  }
  throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
}
export function bindingJsonError(error: unknown) {
  if (error instanceof ComposioBindingError)
    return Response.json(
      { code: error.code, error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  if (error instanceof HttpError && [400, 401, 403, 413].includes(error.status))
    return Response.json(
      {
        code:
          error.status === 400 || error.status === 413
            ? "C_BINDING_INVALID_INPUT"
            : "C_BINDING_FORBIDDEN",
        error:
          error.status === 413
            ? "Solicitud demasiado grande. / Request too large."
            : error.status === 400
              ? bindingMessages.C_BINDING_INVALID_INPUT.join(" / ")
              : bindingMessages.C_BINDING_FORBIDDEN.join(" / "),
      },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  return Response.json(
    {
      code: "C_BINDING_UNAVAILABLE",
      error: bindingMessages.C_BINDING_UNAVAILABLE.join(" / "),
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
export async function composioBindingPage(
  db: SupabaseClient,
  account: string,
  cursor: string | null,
  pageSize: number,
) {
  const data = result(
    await db.rpc("composio_binding_page", {
      account,
      cursor,
      page_size: pageSize,
    }),
  );
  const parsed = bindingPageSchema.safeParse(data);
  if (!parsed.success)
    throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
  return parsed.data;
}
export async function composioBindingCommand(
  db: SupabaseClient,
  account: string,
  body: unknown,
) {
  const input = parseBindingCommand(body);
  if (!input) throw new ComposioBindingError("C_BINDING_INVALID_INPUT", 400);
  const data = result(
    await db.rpc("composio_binding_command", {
      account,
      kind: input.kind,
      p: input.payload,
      request_key: input.idempotency_key,
    }),
  );
  const parsed = bindingResultSchema.safeParse(data);
  if (!parsed.success)
    throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
  return parsed.data;
}

const checkResult = z.strictObject({
  id: z.uuid(),
  status: z.enum(["prepared", "completed", "failed"]),
});
const invalidContextHash = createHash("sha256")
  .update("C2:invalid-server-context")
  .digest("hex");
// Explicit clients/dependencies only. No caller from a route, worker, UI or live transport.
type CheckClients = {
  human: SupabaseClient;
  service: SupabaseClient;
  context: () => unknown;
};
async function publishVerificationContext(
  clients: CheckClients,
  account: string,
) {
  const context = clients.context();
  const hash = verificationContextHash(context);
  result(
    await clients.service.rpc("composio_binding_check_context", {
      account,
      context_digest: hash ?? invalidContextHash,
    }),
  );
  if (!hash) throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
  // Snapshot so an injected reader mutating its object cannot alter this attempt in flight.
  return { hash, context: structuredClone(context) };
}
export async function composioBindingCheck(
  clients: CheckClients,
  account: string,
  binding: string,
  expected: ReturnType<typeof bindingExpected>,
  dependencies: ComposioVerificationDependencies,
  options: { signal?: AbortSignal; timing?: VerificationTiming } = {},
) {
  const page = await composioBindingPage(clients.human, account, null, 25);
  const parsed = parseBindingCommand({
    kind: "confirm_binding",
    payload: { ...expected, binding_id: binding, check_id: randomUUID() },
    idempotency_key: randomUUID(),
  });
  if (!parsed) throw new ComposioBindingError("C_BINDING_INVALID_INPUT", 400);
  const currentExpected = bindingExpected(page);
  if (
    page.current?.id !== binding ||
    Object.entries(currentExpected).some(
      ([key, value]) => expected[key as keyof typeof expected] !== value,
    )
  )
    throw new ComposioBindingError("C_BINDING_STALE");
  const initial = await publishVerificationContext(clients, account);
  const nonce = randomBytes(32).toString("hex"),
    nonceHash = createHash("sha256").update(nonce).digest("hex");
  const begun = checkResult.safeParse(
    result(
      await clients.human.rpc("composio_binding_check_begin", {
        account,
        binding,
        expected,
        context_digest: initial.hash,
        nonce_hash: nonceHash,
        request_key: randomUUID(),
      }),
    ),
  );
  if (!begun.success || begun.data.status !== "prepared")
    throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
  const target = verificationTargetSchema.safeParse(
    result(
      await clients.service.rpc("composio_binding_check_snapshot", {
        check_id: begun.data.id,
        nonce,
        context_digest: initial.hash,
      }),
    ),
  );
  if (
    !target.success ||
    target.data.account_id !== account ||
    target.data.binding_id !== binding
  )
    throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
  const facts = await verifyComposioBinding(
    target.data,
    initial.context,
    dependencies,
    options,
  );
  const latest = await publishVerificationContext(clients, account);
  if (latest.hash !== initial.hash)
    throw new ComposioBindingError("C_BINDING_STALE");
  const finished = checkResult.safeParse(
    result(
      await clients.service.rpc("composio_binding_check_finish", {
        check_id: begun.data.id,
        nonce,
        context_digest: initial.hash,
        facts,
      }),
    ),
  );
  if (
    !finished.success ||
    finished.data.status === "prepared" ||
    finished.data.id !== begun.data.id
  )
    throw new ComposioBindingError("C_BINDING_UNAVAILABLE", 503);
  return finished.data;
}

export async function composioBindingConfirm(
  clients: CheckClients,
  account: string,
  body: unknown,
) {
  const input = parseBindingCommand(body);
  if (!input || input.kind !== "confirm_binding")
    throw new ComposioBindingError("C_BINDING_INVALID_INPUT", 400);
  // Human authorization before any service metadata change; SQL repeats it before receipt/replay.
  await composioBindingPage(clients.human, account, null, 25);
  await publishVerificationContext(clients, account);
  return composioBindingCommand(clients.human, account, body);
}
