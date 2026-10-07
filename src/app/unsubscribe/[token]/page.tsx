import { serviceClient, checkDb } from "@/lib/server/supabase";
import { hash } from "@/lib/server/crypto";
export const dynamic = "force-dynamic";
export default async function Unsubscribe({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let valid = false;
  try {
    const row = checkDb(
      await serviceClient()
        .from("unsubscribe_links")
        .select("contact_id")
        .eq("token_hash", hash(token))
        .maybeSingle(),
    );
    valid = !!row;
  } catch {}
  return (
    <main className="application-page">
      <section className="application-card">
        <h1>Email preferences</h1>
        {valid ? (
          <form action={`/api/public/unsubscribe/${token}`} method="post">
            <p>
              Confirm that you want to stop receiving outreach emails from
              Curated Financial.
            </p>
            <button className="button primary">Unsubscribe</button>
          </form>
        ) : (
          <p>
            This link is invalid. Contact your representative to update your
            preferences.
          </p>
        )}
      </section>
    </main>
  );
}
