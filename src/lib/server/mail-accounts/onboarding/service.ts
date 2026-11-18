import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mailConnectionInput,
  mailConnectionView,
  mailConnectionsOptions,
  type MailConnection,
} from "../../../mail-connections";
import { HttpError } from "../../supabase";

export function stepKey(id: string, step: string) {
  const h = createHash("sha256")
    .update(id + ":" + step)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function simpleRpc(
  db: Pick<SupabaseClient, "rpc">,
  name: string,
  p: Record<string, unknown> = {},
) {
  const r = await db.rpc(name, p);
  if (r.error) {
    const code =
      typeof r.error.message === "string" &&
      /^SIMPLE_[A-Z_]+$/.test(r.error.message)
        ? r.error.message
        : "SIMPLE_UNAVAILABLE";
    throw new HttpError(
      code === "SIMPLE_FORBIDDEN"
        ? 403
        : code === "SIMPLE_INVALID_INPUT"
          ? 400
          : code === "SIMPLE_UNAVAILABLE"
            ? 503
            : 409,
      code,
    );
  }
  return r.data;
}
export const privateConnection = z.object({
  id: z.uuid(),
  actor_id: z.uuid(),
  email: z.email(),
  advisor_id: z.uuid(),
  organization: z.string(),
  domain: z.string(),
  brand_id: z.uuid(),
  provider: z.enum(["gmail_oauth", "composio"]),
  state: z.string(),
  state_hash: z.string(),
  encrypted_state: z.string(),
  provider_attempt_id: z.uuid().nullable(),
  account_id: z.uuid().nullable(),
  identity_saved: z.boolean(),
  exchange_started: z.boolean().default(false),
  deadline: z.string(),
  request_key: z.uuid(),
});
export type PrivateConnection = z.infer<typeof privateConnection>;
export interface OnboardingPorts {
  human: Pick<SupabaseClient, "rpc">;
  service: Pick<SupabaseClient, "rpc">;
  workspace(): { id: string; domain: string };
  state(): string;
  encrypt(value: string): string;
  decrypt(value: string): string;
  directUrl(record: PrivateConnection, state: string): Promise<string>;
  composioBegin(record: PrivateConnection): Promise<string>;
  composioUrl(record: PrivateConnection): Promise<string>;
  composioPrepare(record: PrivateConnection): Promise<boolean>;
  activate(record: PrivateConnection): Promise<void>;
}
export function createOnboarding(p: OnboardingPorts) {
  async function read(id: string) {
    const view = mailConnectionView.parse(
      await simpleRpc(p.human, "simple_mail_get", { id }),
    );
    const record = privateConnection.parse(
      await simpleRpc(p.service, "simple_mail_private", { id }),
    );
    if (
      view.id !== record.id ||
      view.email !== record.email ||
      view.provider !== record.provider
    )
      throw new HttpError(409, "SIMPLE_CONFLICT");
    return { view, record };
  }
  async function budget() {
    if ((await simpleRpc(p.service, "simple_mail_included_available")) !== true)
      throw new HttpError(409, "SIMPLE_INCLUDED_UNAVAILABLE");
  }
  return {
    async options() {
      return mailConnectionsOptions.parse(
        await simpleRpc(p.human, "simple_mail_options"),
      );
    },
    async get(id: string) {
      return (await read(z.uuid().parse(id))).view;
    },
    async begin(value: unknown) {
      const input = mailConnectionInput.parse(value),
        workspace = p.workspace(),
        state = p.state();
      if (input.email.split("@")[1] !== workspace.domain)
        throw new HttpError(400, "SIMPLE_WORKSPACE_MISMATCH");
      if (input.provider === "composio") await budget();
      const initial = mailConnectionView.parse(
        await simpleRpc(p.human, "simple_mail_begin", {
          p: input,
          state_hash: createHash("sha256").update(state).digest("hex"),
          encrypted_state: p.encrypt(state),
          organization: workspace.id,
          domain: workspace.domain,
        }),
      );
      const { record } = await read(initial.id);
      if (initial.state === "ready" || record.identity_saved) return initial;
      let url: string;
      if (record.provider === "gmail_oauth")
        url = await p.directUrl(record, p.decrypt(record.encrypted_state));
      else {
        await budget();
        if (!record.provider_attempt_id) {
          const attempt = await p.composioBegin(record);
          await simpleRpc(p.human, "simple_mail_update", {
            id: record.id,
            provider_attempt: z.uuid().parse(attempt),
          });
        }
        url = await p.composioUrl((await read(record.id)).record);
      }
      const ready = mailConnectionView.parse(
        await simpleRpc(p.human, "simple_mail_update", { id: record.id }),
      );
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password)
        throw new HttpError(503, "SIMPLE_UNAVAILABLE");
      return { ...ready, authorization_url: parsed.href };
    },
    async continue(id: string) {
      const { record, view } = await read(z.uuid().parse(id));
      if (view.state === "ready" || view.state === "disconnected") return view;
      if (record.provider === "gmail_oauth" && !record.identity_saved) {
        if (
          record.state === "attention" ||
          Date.parse(record.deadline) <= Date.now()
        )
          throw new HttpError(409, "SIMPLE_AUTHORIZATION_REQUIRED");
        if (record.exchange_started) return view;
        return {
          ...view,
          authorization_url: await p.directUrl(
            record,
            p.decrypt(record.encrypted_state),
          ),
        };
      }
      if (record.provider === "composio") {
        await budget();
        if (!record.provider_attempt_id) {
          const attempt = await p.composioBegin(record);
          await simpleRpc(p.human, "simple_mail_update", {
            id,
            provider_attempt: z.uuid().parse(attempt),
          });
          const latest = (await read(id)).record;
          return {
            ...(await read(id)).view,
            authorization_url: await p.composioUrl(latest),
          };
        }
        if (!(await p.composioPrepare(record)))
          return {
            ...(await read(id)).view,
            authorization_url: await p.composioUrl(record),
          };
      } else await simpleRpc(p.human, "simple_mail_confirm", { id });
      const latest = (await read(id)).record;
      await p.activate(latest);
      return mailConnectionView.parse(
        await simpleRpc(p.human, "simple_mail_finalize", { id }),
      );
    },
    async disconnect(id: string) {
      return mailConnectionView.parse(
        await simpleRpc(p.human, "simple_mail_disconnect", {
          id: z.uuid().parse(id),
        }),
      );
    },
  };
}
export function simpleConnectionError(error: unknown) {
  const code =
    error instanceof HttpError && /^SIMPLE_[A-Z_]+$/.test(error.message)
      ? error.message
      : "SIMPLE_UNAVAILABLE";
  const messages: Record<string, string> = {
    SIMPLE_COMPOSIO_DISABLED:
      "Composio permanece deshabilitado. Puedes usar Gmail directo.",
    SIMPLE_ADVISOR_REQUIRED: "Selecciona el asesor responsable de este correo.",
    SIMPLE_AUTHORIZATION_REQUIRED:
      "La autorización no se completó. Usa Reconectar para volver a Google.",
    SIMPLE_INCLUDED_UNAVAILABLE:
      "Composio no tiene cupo gratuito confirmado. Gmail directo sigue disponible.",
    SIMPLE_WORKSPACE_MISMATCH:
      "Este correo no pertenece al Workspace configurado.",
    SIMPLE_FORBIDDEN: "Revisa tu sesión de superadmin y completa MFA.",
    SIMPLE_CONFLICT:
      "La cuenta cambió. Actualiza su estado antes de continuar.",
    SIMPLE_ACCESS_CONFLICT:
      "Este buzón tiene otros accesos asignados. Revisa sus permisos antes de cambiar el responsable.",
    SIMPLE_EXPIRED:
      "La preparación venció. Revisa el estado de la conexión antes de retomarla.",
    SIMPLE_NOT_CONFIGURED:
      "La conexión necesita preparación del administrador.",
  };
  return Response.json(
    {
      code,
      error:
        messages[code] ??
        "No se pudo completar la conexión. Actualiza el estado para retomarla.",
    },
    {
      status: error instanceof HttpError ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
