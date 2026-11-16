import type { requireUser } from "./supabase";
import { checkOrigin, HttpError, jsonError } from "./supabase";
import { readBounded } from "./body";
import {
  canManageUsers,
  userCommandSchema,
  userListQuerySchema,
  type UserCommand,
  type UserListQuery,
} from "../user-management";

type Context = Awaited<ReturnType<typeof requireUser>>;
export type UserManagementDependencies = {
  authenticate: () => Promise<Context>;
  list: (context: Context, query: UserListQuery) => Promise<unknown>;
  execute: (context: Context, command: UserCommand) => Promise<unknown>;
};
export async function userManagementResponse(
  request: Request,
  dependencies: UserManagementDependencies,
) {
  try {
    if (!["GET", "POST"].includes(request.method))
      throw new HttpError(405, "Método no permitido. / Method not allowed.");
    if (request.method === "POST") checkOrigin(request);
    const context = await dependencies.authenticate();
    if (!canManageUsers(context.profile))
      throw new HttpError(
        403,
        "Acceso exclusivo para superadmin. / Superadmin access required.",
      );
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      if (new Set(params.keys()).size !== [...params.keys()].length)
        throw new HttpError(400, "Consulta inválida. / Invalid query.");
      const query = userListQuerySchema.safeParse(Object.fromEntries(params));
      if (!query.success)
        throw new HttpError(400, "Consulta inválida. / Invalid query.");
      return Response.json(await dependencies.list(context, query.data), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      throw new HttpError(400, "Se requiere JSON. / JSON required.");
    let raw: unknown;
    const bytes = await readBounded(request, 32768);
    try {
      raw = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new HttpError(400, "Solicitud inválida. / Invalid request.");
    }
    const command = userCommandSchema.safeParse(raw);
    if (!command.success)
      throw new HttpError(
        400,
        "Revisa los campos: contraseña de 12 a 128 caracteres y texto privado de hasta 4.000. / Check fields: password 12–128 characters, private text up to 4,000.",
      );
    return Response.json(await dependencies.execute(context, command.data), {
      status: command.data.action === "create" ? 201 : 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = jsonError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
