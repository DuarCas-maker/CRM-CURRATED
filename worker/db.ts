import { createClient } from "@supabase/supabase-js";
import { WorkerDatabaseError } from "./errors";
export function db() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new Error("MISSING_SUPABASE");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export function checked<T>(r: {
  data: T;
  error: { message: string; code?: string } | null;
}): T {
  if (r.error) throw new WorkerDatabaseError(r.error.code);
  return r.data;
}
export async function alertAdmins(event: string, title: string) {
  const client = db();
  const admins =
    checked(
      await client
        .from("profiles")
        .select("id")
        .in("role", ["superadmin"])
        .eq("active", true),
    ) || [];
  for (const admin of admins)
    checked(
      await client.rpc("notify_user", {
        recipient: admin.id,
        event,
        title_text: title,
      }),
    );
}
