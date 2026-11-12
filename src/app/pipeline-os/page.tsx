import { redirect } from "next/navigation";
import { configured, HttpError } from "@/lib/server/supabase";
import { loadWorkspace } from "@/lib/server/workspace";
import { loadPipelineBoard } from "@/lib/server/pipeline-os-module";
import { PipelineOSWorkspace } from "@/components/pipeline-os/workspace";

export const dynamic = "force-dynamic";
export default async function PipelineOSPage() {
  if (!configured()) redirect("/login");
  try {
    const [initial, initialBoard] = await Promise.all([
      loadWorkspace(new URLSearchParams({ view: "pipeline" })),
      loadPipelineBoard(),
    ]);
    return (
      <PipelineOSWorkspace initial={initial} initialBoard={initialBoard} />
    );
  } catch (e) {
    if (e instanceof HttpError && [401, 403].includes(e.status))
      redirect("/login");
    throw e;
  }
}
