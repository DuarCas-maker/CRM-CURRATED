import { requireUser, checkDb, jsonError } from "@/lib/server/supabase";
import { lenderCataloguePdf } from "@/lib/server/lender-catalogue-pdf";
import type { Lender } from "@/lib/domain";
export async function GET() {
  try {
    const { db } = await requireUser();
    const lenders: Lender[] = [];
    for (let offset = 0; ; offset += 1000) {
      const rows =
        checkDb(
          await db
            .from("lenders")
            .select("*")
            .is("archived_at", null)
            .order("id")
            .range(offset, offset + 999),
        ) || [];
      lenders.push(...rows);
      if (rows.length < 1000) break;
    }
    const bytes = await lenderCataloguePdf(lenders);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=lender-tiers.pdf",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
