import { ApplicationForm } from "@/components/application-form";
import { resolveApplicationLink } from "@/lib/server/application-links";
import { demoEnabled } from "@/lib/server/supabase";
import { demoDeclaration } from "@/lib/application";
export const dynamic = "force-dynamic";
export default async function Apply({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (token === "demo" && demoEnabled())
    return <ApplicationForm token="demo" declaration={demoDeclaration} demo />;
  try {
    const { db, link } = await resolveApplicationLink(token);
    const { data: app } = await db
      .from("applications")
      .select("id")
      .eq("opportunity_id", link.opportunity_id)
      .maybeSingle();
    const { data: documents } = await db
      .from("documents")
      .select("id,name,status,kind,period")
      .eq("opportunity_id", link.opportunity_id);
    return (
      <ApplicationForm
        token={token}
        declaration={process.env.FORM_DECLARATION_TEXT!}
        submitted={!!app}
        documents={documents || []}
      />
    );
  } catch {
    return (
      <main className="application-page">
        <section className="application-card">
          <h1>Application unavailable</h1>
          <p>
            This link is invalid, expired, or not yet enabled. Please contact
            your Curated Financial representative.
          </p>
        </section>
      </main>
    );
  }
}
