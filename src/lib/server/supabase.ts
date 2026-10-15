import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Profile } from "../domain";
export const configured = () =>
  !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
export const demoEnabled = () =>
  process.env.NODE_ENV !== "production" || process.env.DEMO_ENABLED === "true";
export async function userClient() {
  if (!configured())
    throw new HttpError(
      503,
      "Supabase no está configurado / Supabase is not configured",
    );
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          try {
            values.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* Server components cannot set cookies. Route handlers refresh sessions. */
          }
        },
      },
    },
  );
}
export function serviceClient(): SupabaseClient {
  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL
  )
    throw new HttpError(503, "Server integration is not configured");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
export async function requireUser() {
  const db = await userClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) throw new HttpError(401, "Inicia sesión / Sign in");
  const assurance = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.data?.currentLevel !== "aal2")
    throw new HttpError(
      403,
      "Completa el segundo factor / Complete two-factor authentication",
    );
  const { data: profile } = await db
    .from("profiles")
    .select("id,name,email,role,active")
    .eq("id", user.id)
    .single();
  if (!profile?.active)
    throw new HttpError(
      403,
      "Se requiere una invitación activa / An active invitation is required",
    );
  return { db, user, profile: profile as Profile };
}
function normalizedOrigin(value: string | null | undefined): string | null {
  try {
    const url = new URL(value?.trim() || "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export function checkOrigin(request: Request) {
  const origin = normalizedOrigin(request.headers.get("origin"));
  const allowed = normalizedOrigin(
    process.env.APP_ORIGIN ||
      (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : ""),
  );
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    ["http://localhost:3000", "http://127.0.0.1:3000"].includes(origin || "");
  if (localDevelopment) return;
  if (!allowed)
    throw new HttpError(
      503,
      "Configura APP_ORIGIN con la dirección pública del CRM, sin rutas ni parámetros. / Configure APP_ORIGIN with the CRM public origin.",
    );
  if (origin !== allowed)
    throw new HttpError(
      403,
      "La dirección de esta página no coincide con APP_ORIGIN. Revisa esa variable en la aplicación web de Coolify. / Invalid request origin: check the web APP_ORIGIN configuration.",
    );
}
export function jsonError(e: unknown) {
  if (e instanceof HttpError)
    return Response.json({ error: e.message }, { status: e.status });
  return Response.json(
    {
      error:
        "No se pudo completar la operación. / The operation could not be completed.",
    },
    { status: 500 },
  );
}
export function checkDb<T>(
  result: {
    data: T;
    error: { message: string; code?: string } | null;
  },
  operation?: string,
): T {
  if (result.error)
    throw new HttpError(
      400,
      result.error.message,
      operation ? { cause: { operation, code: result.error.code } } : undefined,
    );
  return result.data;
}
