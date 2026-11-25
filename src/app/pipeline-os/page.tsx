import { redirect } from "next/navigation";
import { configured, HttpError } from "@/lib/server/supabase";
import { loadWorkspace } from "@/lib/server/workspace";
import { PipelineOSWorkspace } from "@/components/pipeline-os/workspace";

export const dynamic = "force-dynamic";
export default async function PipelineOSPage() {
  if (!configured()) redirect("/login");
  try {
    const initial = await loadWorkspace(new URLSearchParams({ view: "pipeline" }));
    // The board reads the full mail history. Its failure must not prevent
    // independent modules (campaigns, imports or templates) from opening.
    return <PipelineOSWorkspace initial={initial} />;
  } catch (e) {
    if (e instanceof HttpError && [401, 403].includes(e.status))
      redirect("/login");
    throw e;
  }
}
