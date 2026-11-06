import { z } from "zod";
import { requireUser } from "@/lib/server/supabase";
import {
  BrandError,
  brandJsonError,
  brandPage,
} from "@/lib/server/brand-actions";
import { brandCollections } from "@/lib/brand-management";

export async function GET(request: Request) {
  try {
    const { db } = await requireUser();
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some(
        (k) => !["collection", "cursor", "limit"].includes(k),
      )
    )
      throw new BrandError("BRAND_INVALID_INPUT", 400);
    const collection = z
      .enum(brandCollections)
      .safeParse(params.get("collection") || "brands");
    const limit = params.get("limit") || "25";
    const cursor = params.get("cursor");
    if (
      !collection.success ||
      !/^(?:[1-9]|[1-9][0-9]|100)$/.test(limit) ||
      (cursor !== null &&
        (collection.data === "memberships"
          ? cursor.split(":").length !== 2 ||
            cursor.split(":").some((v) => !z.uuid().safeParse(v).success)
          : !z.uuid().safeParse(cursor).success))
    )
      throw new BrandError("BRAND_INVALID_INPUT", 400);
    return Response.json(
      await brandPage(db, collection.data, cursor, Number(limit)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return brandJsonError(e);
  }
}
