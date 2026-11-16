import { z } from "zod";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Profile } from "../domain";
import {
  canManageUsers,
  userPageSchema,
  type UserCommand,
  type UserListQuery,
} from "../user-management";
import { encrypt, decrypt } from "./crypto";
import { HttpError, serviceClient } from "./supabase";

type Db = Pick<SupabaseClient, "rpc">;
type Options = {
  service?: () => SupabaseClient;
  seal?: typeof encrypt;
  open?: typeof decrypt;
};
const timedFetch: typeof fetch = (input, init) => {
  const signal = init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000);
  return fetch(input, { ...init, signal });
};
function checked<T>(result: {
  data: T;
  error: { message?: string; code?: string } | null;
}): T {
  if (!result.error) return result.data;
  const { message, code } = result.error;
  if (message === "USER_FORBIDDEN")
    throw new HttpError(
      403,
      "Acceso exclusivo para superadmin. / Superadmin access required.",
    );
  if (message === "USER_OWN_ACCESS")
    throw new HttpError(
      403,
      "No puedes cambiar tu propio rol ni desactivar tu acceso. / You cannot change your own access.",
    );
  if (message === "USER_NOT_FOUND")
    throw new HttpError(404, "Usuario no encontrado. / User not found.");
  if (message === "USER_CONFLICT")
    throw new HttpError(
      409,
      "Los datos cambiaron. Actualiza la lista antes de guardar. / Data changed. Refresh before saving.",
    );
  if (message === "USER_INVALID")
    throw new HttpError(400, "Revisa los campos. / Check the fields.");
  if (["PGRST202", "42P01", "42883"].includes(code || ""))
    throw new HttpError(
      503,
      "El módulo de usuarios está pendiente de activación. / User management is awaiting activation.",
    );
  throw new HttpError(
    503,
    "No se pudo completar la operación de usuarios. / The user operation could not be completed.",
  );
}
function authFailure(error: { status?: number; code?: string }) {
  if (["email_exists", "user_already_exists"].includes(error.code || ""))
    return new HttpError(
      409,
      "Ese correo ya tiene un usuario. / That email already has a user.",
    );
  if (error.code === "weak_password")
    return new HttpError(
      400,
      "La contraseña no cumple la política de seguridad. / Password does not meet security requirements.",
    );
  if (error.status === 429)
    return new HttpError(
      429,
      "Espera un momento antes de intentarlo otra vez. / Wait before trying again.",
    );
  return new HttpError(
    503,
    "No se pudo confirmar el cambio de acceso. Reintenta con el mismo formulario. / Could not confirm the access change. Retry with the same form.",
  );
}
export async function listManagedUsers(db: Db, query: UserListQuery) {
  return userPageSchema.parse(
    checked(
      await db.rpc("user_management_list", {
        p_search: query.q,
        p_page: query.page,
      }),
    ),
  );
}
function creationMatches(
  user: User,
  actor: Profile,
  command: Extract<UserCommand, { action: "create" }>,
) {
  const marker = user.app_metadata?.crm_managed_creation;
  return (
    user.id === command.request_id &&
    user.email?.toLowerCase() === command.email &&
    marker?.actor_id === actor.id &&
    marker?.name === command.name &&
    marker?.email === command.email &&
    marker?.role === command.role
  );
}
export async function executeUserCommand(
  db: Db,
  actor: Profile,
  command: UserCommand,
  options: Options = {},
) {
  if (!canManageUsers(actor))
    throw new HttpError(
      403,
      "Acceso exclusivo para superadmin. / Superadmin access required.",
    );
  if (command.action === "access") {
    checked(
      await db.rpc("user_management_access", {
        p_target: command.user_id,
        p_role: command.role,
        p_active: command.active,
        p_expected_role: command.expected_role,
        p_expected_active: command.expected_active,
      }),
    );
    return { ok: true };
  }
  const service = (options.service || (() => serviceClient(timedFetch)))();
  checked(
    await service.rpc("user_management_assert_actor", { p_actor: actor.id }),
  );
  if (command.action === "create") {
    // request_id is also the Auth ID. An uncertain Auth response can be reconciled
    // without resending a password or changing a previously completed account.
    const previous = await service.auth.admin.getUserById(command.request_id);
    if (previous.error && previous.error.status !== 404)
      throw authFailure(previous.error);
    if (previous.data.user) {
      if (!creationMatches(previous.data.user, actor, command))
        throw new HttpError(
          409,
          "La solicitud ya se utilizó para otros datos. / This request was used for different data.",
        );
    } else {
      for (const table of ["profiles", "invitations"]) {
        const existing = checked(
          await service
            .from(table)
            .select("email")
            .eq("email", command.email)
            .maybeSingle(),
        );
        if (existing)
          throw new HttpError(
            409,
            "Ese correo ya tiene un usuario o una invitación. / That email already has a user or invitation.",
          );
      }
      const created = await service.auth.admin.createUser({
        id: command.request_id,
        email: command.email,
        password: command.password,
        email_confirm: true,
        app_metadata: {
          crm_managed_creation: {
            actor_id: actor.id,
            name: command.name,
            email: command.email,
            role: command.role,
          },
        },
      });
      if (created.error) throw authFailure(created.error);
      if (
        !created.data.user ||
        !creationMatches(created.data.user, actor, command)
      )
        throw new HttpError(
          503,
          "No se pudo confirmar la creación del usuario. / User creation could not be confirmed.",
        );
    }
    const id = checked(
      await service.rpc("user_management_finish_create", {
        p_actor: actor.id,
        p_id: command.request_id,
        p_name: command.name,
        p_email: command.email,
        p_role: command.role,
      }),
    );
    return { ok: true, id };
  }
  if (command.action === "password") {
    checked(
      await service.rpc("user_management_password_audit", {
        p_actor: actor.id,
        p_target: command.user_id,
        p_action: "user_password_requested",
      }),
    );
    const updated = await service.auth.admin.updateUserById(command.user_id, {
      password: command.password,
    });
    if (updated.error) throw authFailure(updated.error);
    checked(
      await service.rpc("user_management_password_audit", {
        p_actor: actor.id,
        p_target: command.user_id,
        p_action: "user_password_changed",
      }),
    );
    return { ok: true };
  }
  if (command.action === "private_text") {
    let ciphertext: string | null = null;
    try {
      if (command.text !== "")
        ciphertext = (options.seal || encrypt)(
          JSON.stringify({ user_id: command.user_id, text: command.text }),
        );
    } catch {
      throw new HttpError(
        503,
        "El almacenamiento privado no está disponible. / Private storage is unavailable.",
      );
    }
    const version = checked(
      await service.rpc("user_management_private_write", {
        p_actor: actor.id,
        p_target: command.user_id,
        p_ciphertext: ciphertext,
        p_expected_version: command.expected_version,
      }),
    );
    return { ok: true, version, has_private_text: command.text !== "" };
  }
  const value = z
    .object({
      encrypted_text: z.string().nullable(),
      version: z.number().int().nonnegative(),
    })
    .parse(
      checked(
        await service.rpc("user_management_private_read", {
          p_actor: actor.id,
          p_target: command.user_id,
        }),
      ),
    );
  if (value.encrypted_text === null)
    return { text: "", version: value.version };
  try {
    const payload = z
      .object({
        user_id: z.literal(command.user_id),
        text: z.string().max(4000),
      })
      .strict()
      .parse(JSON.parse((options.open || decrypt)(value.encrypted_text)));
    return { text: payload.text, version: value.version };
  } catch {
    throw new HttpError(
      503,
      "No se pudo abrir el texto privado. / The private text could not be opened.",
    );
  }
}
