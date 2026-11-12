import { notFound } from "next/navigation";
import { demoEnabled } from "@/lib/server/supabase";
import { pipelineModuleDemo } from "@/lib/pipeline-os/demo";
import { buildPipelineBoard } from "@/lib/pipeline-os/module";
import { PipelineOSWorkspace } from "@/components/pipeline-os/workspace";

export const dynamic = "force-dynamic";
export default function PipelineOSDemoPage() {
  if (!demoEnabled()) notFound();
  const { data, processes } = pipelineModuleDemo();
  return (
    <PipelineOSWorkspace
      initial={data}
      initialBoard={buildPipelineBoard(data, processes)}
      processes={processes}
    />
  );
}
