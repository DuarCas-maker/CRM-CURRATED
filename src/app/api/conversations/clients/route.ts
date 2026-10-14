import { requireUser, checkDb, jsonError } from "@/lib/server/supabase";
import { z } from "zod";

const columns =
  "id,company_id,contact_id,company,contact,email,product,stage,updated_at";
export async function GET(request: Request) {
  try {
    const { db } = await requireUser();
    const params = new URL(request.url).searchParams;
    const q = (params.get("q") || "")
      .slice(0, 150)
      .replace(/[%,()"\\]/g, " ")
      .trim();
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(params.get("page") || 0);
    const base = () =>
      db
        .from("opportunity_inbox")
        .select(columns, { count: "exact" })
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .order("id");
    if (!q) {
      const rows = await base().range(page * 50, page * 50 + 49);
      return Response.json(
        {
          clients: checkDb(rows) || [],
          total: rows.count || 0,
          hasMore: (rows.count || 0) > (page + 1) * 50,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    // Alias searches must not silently omit customers beyond the first DB page.
    // All queries use the authenticated client and its existing RLS policies.
    const contacts: { id: string; company_id: string | null }[] = [];
    for (let batch = 0; ; batch++) {
      const rows =
        checkDb(
          await db
            .from("contacts")
            .select("id,company_id")
            .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
            .order("id")
            .range(batch * 1000, batch * 1000 + 999),
        ) || [];
      contacts.push(...rows);
      if (rows.length < 1000) break;
    }
    const companies = new Set(
      contacts.map((c) => c.company_id).filter((id): id is string => !!id),
    );
    for (let i = 0; i < contacts.length; i += 100)
      for (let batch = 0; ; batch++) {
        const links =
          checkDb(
            await db
              .from("company_contacts")
              .select("company_id,contact_id")
              .in(
                "contact_id",
                contacts.slice(i, i + 100).map((c) => c.id),
              )
              .in("relationship", ["primary", "contact", "broker"])
              .order("company_id")
              .order("contact_id")
              .range(batch * 1000, batch * 1000 + 999),
          ) || [];
        links.forEach((l) => companies.add(l.company_id));
        if (links.length < 1000) break;
      }
    const matches = new Map<
      string,
      { id: string; updated_at: string; [key: string]: unknown }
    >();
    async function collect(build: () => ReturnType<typeof base>) {
      for (let batch = 0; ; batch++) {
        const rows =
          checkDb(await build().range(batch * 1000, batch * 1000 + 999)) || [];
        rows.forEach((row) => matches.set(row.id, row));
        if (rows.length < 1000) break;
      }
    }
    await collect(() =>
      base().or(`company.ilike.%${q}%,contact.ilike.%${q}%,email.ilike.%${q}%`),
    );
    for (const [column, ids] of [
      ["contact_id", contacts.map((c) => c.id)],
      ["company_id", [...companies]],
    ] as const) {
      for (let i = 0; i < ids.length; i += 100)
        await collect(() => base().in(column, ids.slice(i, i + 100)));
    }
    const sorted = [...matches.values()].sort(
      (a, b) =>
        Date.parse(b.updated_at) - Date.parse(a.updated_at) ||
        a.id.localeCompare(b.id),
    );
    return Response.json(
      {
        clients: sorted.slice(page * 50, page * 50 + 50),
        total: sorted.length,
        hasMore: sorted.length > (page + 1) * 50,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
