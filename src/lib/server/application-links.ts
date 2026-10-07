import { serviceClient, checkDb, HttpError } from "./supabase";
import { token, hash, encrypt } from "./crypto";
export async function makeApplicationLink(
  opportunityId: string,
  actor: string,
) {
  const value = token();
  const service = serviceClient();
  checkDb(
    await service.from("application_links").insert({
      token_hash: hash(value),
      encrypted_token: encrypt(value),
      opportunity_id: opportunityId,
      created_by: actor,
      expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
    }),
  );
  return `${process.env.APP_ORIGIN}/apply/${value}`;
}
export async function resolveApplicationLink(value: string) {
  if (
    process.env.PUBLIC_FORM_ENABLED !== "true" ||
    !process.env.FORM_DECLARATION_TEXT ||
    !process.env.FORM_DECLARATION_VERSION
  )
    throw new HttpError(
      503,
      "Applications are not enabled yet. Contact your representative.",
    );
  if (!/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new HttpError(404, "Invalid application link");
  const db = serviceClient();
  const link = checkDb(
    await db
      .from("application_links")
      .select("id,opportunity_id,expires_at")
      .eq("token_hash", hash(value))
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
  );
  if (!link)
    throw new HttpError(
      404,
      "This link has expired. Ask your representative for a new one.",
    );
  return { db, link };
}
