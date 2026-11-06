import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HttpError, jsonError } from "./supabase";
import {
  brandMessages,
  parseBrandCommand,
  parseBrandPage,
  type BrandErrorCode,
  type BrandCollection,
} from "../brand-management";

export class BrandError extends HttpError {
  constructor(
    public readonly code: BrandErrorCode,
    public readonly statusCode: number,
  ) {
    super(statusCode, brandMessages[code][0]);
  }
}
export function brandResult<T>(r: {
  data: T;
  error: { code?: string; message?: string } | null;
}): T {
  if (!r.error) return r.data;
  const code = r.error.message as BrandErrorCode;
  if (Object.hasOwn(brandMessages, code))
    throw new BrandError(
      code,
      code === "BRAND_FORBIDDEN"
        ? 403
        : code === "BRAND_NOT_FOUND"
          ? 404
          : code === "BRAND_INVALID_INPUT"
            ? 400
            : 409,
    );
  throw new BrandError("BRAND_UNAVAILABLE", 503);
}
export function brandJsonError(e: unknown) {
  return e instanceof BrandError
    ? Response.json(
        { error: e.message, code: e.code },
        { status: e.statusCode, headers: { "Cache-Control": "no-store" } },
      )
    : jsonError(e);
}
export async function brandAction(
  db: SupabaseClient,
  role: string,
  kind: string,
  input: unknown,
  key: string,
) {
  if (role !== "superadmin") throw new BrandError("BRAND_FORBIDDEN", 403);
  const parsed = parseBrandCommand(kind, input);
  if (!parsed || !z.uuid().safeParse(key).success)
    throw new BrandError("BRAND_INVALID_INPUT", 400);
  return brandResult(
    await db.rpc("crm_command", {
      kind: parsed.kind,
      p: parsed.payload,
      request_key: key,
    }),
  );
}
export async function brandPage(
  db: SupabaseClient,
  collection: BrandCollection,
  cursor: string | null,
  size: number,
) {
  const data = brandResult(
    await db.rpc("brand_management_page", {
      collection,
      cursor,
      page_size: size,
    }),
  );
  const page = parseBrandPage(collection, data);
  if (!page) throw new BrandError("BRAND_UNAVAILABLE", 503);
  return page;
}
