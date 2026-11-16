import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Profile } from "../domain";
import { connectionsSchema, type ConnectionAccount } from "../connections";
import { requireUser, HttpError, jsonError } from "./supabase";
import { composioBindingPage } from "./mail-accounts/composio-binding";
import {
  bindingPageV2,
  bindingV2Enabled,
  bindingV2Ports,
} from "./mail-accounts/composio-binding-v2";

const accountSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  organization: z.string(),
  status: z.string(),
  created_at: z.string().nullable().optional(),
});
const permissionSchema = z.object({
  account_id: z.uuid(),
  user_id: z.uuid(),
  can_send: z.boolean(),
});
const profileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
});
function time(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !z.iso.datetime({ offset: true }).safeParse(value).success
  )
    return null;
  return new Date(value).toISOString();
}
// Select only public metadata, using the human's existing RLS context. Never read tokens or message payloads.
async function rows(
  db: SupabaseClient,
  table: string,
  columns: string,
  order: string[],
  filter?: [string, string[]],
  max = 1000,
) {
  const result: unknown[] = [];
  for (let page = 0; ; page++) {
    let q = db
      .from(table)
      .select(columns)
      .range(page * 100, page * 100 + 99);
    for (const key of order) q = q.order(key);
    if (filter) q = q.in(filter[0], filter[1]);
    const r = await q;
    if (r.error || !Array.isArray(r.data))
      throw new HttpError(503, "CONNECTIONS_UNAVAILABLE");
    result.push(...r.data);
    if (result.length > max)
      throw new HttpError(503, "CONNECTIONS_CATALOG_LIMIT");
    if (r.data.length < 100) return result;
  }
}
export async function readConnections(db: SupabaseClient) {
  const accounts = z
    .array(accountSchema)
    .parse(
      await rows(
        db,
        "mail_accounts",
        "id,email,organization,status,created_at",
        ["id"],
      ),
    );
  if (new Set(accounts.map((a) => a.id)).size !== accounts.length)
    throw new HttpError(503, "CONNECTIONS_CATALOG_CHANGED");
  let permissions: z.infer<typeof permissionSchema>[] | null = [],
    profiles: z.infer<typeof profileSchema>[] = [];
  if (accounts.length) {
    try {
      permissions = z
        .array(permissionSchema)
        .parse(
          await rows(
            db,
            "mail_permissions",
            "account_id,user_id,can_send",
            ["account_id", "user_id"],
            ["account_id", accounts.map((a) => a.id)],
            10000,
          ),
        );
      const ids = [...new Set(permissions.map((p) => p.user_id))];
      if (ids.length)
        profiles = z
          .array(profileSchema)
          .parse(
            await rows(
              db,
              "profiles",
              "id,name,active",
              ["id"],
              ["id", ids],
              10000,
            ),
          );
      if (ids.some((id) => !profiles.some((p) => p.id === id)))
        permissions = null;
    } catch {
      permissions = null;
    }
  }
  const output: ConnectionAccount[] = [];
  for (let offset = 0; offset < accounts.length; offset += 4) {
    output.push(
      ...(await Promise.all(
        accounts.slice(offset, offset + 4).map(async (a) => {
          const row: ConnectionAccount = {
            id: a.id,
            email: a.email,
            organization: a.organization,
            status: a.status,
            registered_at: time(a.created_at),
            brand: null,
            association: "unavailable",
            association_stale: null,
            association_at: null,
            reviewed_at: null,
            messages: null,
            synced_at: null,
            permissions:
              permissions === null
                ? null
                : permissions
                    .filter((p) => p.account_id === a.id)
                    .map((p) => {
                      const person = profiles.find((u) => u.id === p.user_id)!;
                      return {
                        name: person.name,
                        active: person.active,
                        can_send: p.can_send,
                      };
                    }),
            can_send: null,
          };
          await Promise.allSettled([
            (async () => {
              const page = bindingV2Enabled()
                ? await bindingPageV2(bindingV2Ports(db), a.id, null, 1)
                : await composioBindingPage(db, a.id, null, 1);
              if (page.account.id !== a.id) return;
              row.brand = page.account.brand_name;
              row.association = page.current?.status ?? "none";
              row.association_stale = page.current?.stale ?? false;
              row.association_at = time(page.current?.created_at);
              row.reviewed_at = time(page.current?.reviewed_at);
            })(),
            (async () => {
              const r = await db
                .from("gmail_archive_messages")
                .select("id", { head: true, count: "exact" })
                .eq("account_id", a.id);
              if (!r.error && Number.isSafeInteger(r.count) && r.count! >= 0)
                row.messages = r.count!;
            })(),
            (async () => {
              const r = await db
                .from("gmail_sync_state")
                .select("last_synced_at")
                .eq("account_id", a.id)
                .maybeSingle();
              if (!r.error) row.synced_at = time(r.data?.last_synced_at);
            })(),
            (async () => {
              const r = await db.rpc("can_send", { account: a.id });
              if (!r.error && typeof r.data === "boolean")
                row.can_send = r.data;
            })(),
          ]);
          return row;
        }),
      )),
    );
  }
  return connectionsSchema.parse({
    generated_at: new Date().toISOString(),
    accounts: output,
    instantly: {
      configuration_present: !!process.env.INSTANTLY_API_KEY?.trim(),
      connection_verified: false,
    },
  });
}
type Dependencies = {
  authorize(): Promise<{ db: SupabaseClient; profile: Profile }>;
  read(db: SupabaseClient): Promise<unknown>;
};
export async function connectionsGet(
  request: Request,
  deps: Dependencies = { authorize: requireUser, read: readConnections },
) {
  try {
    const { db, profile } = await deps.authorize();
    if (!profile.active || profile.role !== "superadmin")
      throw new HttpError(403, "Superadmin required");
    if (new URL(request.url).search)
      throw new HttpError(400, "CONNECTIONS_INVALID_QUERY");
    return Response.json(connectionsSchema.parse(await deps.read(db)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const response = jsonError(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
