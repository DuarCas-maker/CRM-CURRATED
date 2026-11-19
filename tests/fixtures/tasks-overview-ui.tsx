import { createRoot } from "react-dom/client";
import { useState } from "react";
import { PipelineOSWorkspace } from "../../src/components/pipeline-os/workspace";
import { pipelineModuleDemo } from "../../src/lib/pipeline-os/demo";
import {
  buildPipelineBoard,
  parsePipelineQuery,
  type PipelineProcess,
} from "../../src/lib/pipeline-os/module";
import {
  buildTasksOverview,
  parseTaskOverviewQuery,
} from "../../src/lib/pipeline-os/tasks-overview";
import { tasksOverviewFixture, overviewNow } from "./tasks-overview";

const source = tasksOverviewFixture();
const { data } = pipelineModuleDemo();
data.demo = false;
data.profile = source.profile;
data.profiles = source.profiles;
data.preferences.locale = "es";
data.accounts = source.accounts.map((a) => ({ ...data.accounts[0], ...a }));
const opportunity = data.opportunities[0],
  lead = data.leads[0];
data.opportunities = source.leads.map((l) => ({
  ...opportunity,
  id: l.opportunity_id!,
  company: l.company,
  contact: l.contact,
  email: l.email,
  seller_id: l.seller_id,
  closer_id: null,
  funded_at: null,
  funded_amount: null,
  handed_off_at: null,
  stage: "application_pending",
  application_complete: false,
  application_signed: false,
}));
data.leads = source.leads.map((l) => ({ ...lead, ...l }));
data.tasks = [];
const offerSeed = data.offers[0],
  submissionSeed = data.submissions[0];
data.offers = [];
data.submissions = [];
data.documents = [];
const processes: PipelineProcess[] = [];
for (const [index, row] of data.opportunities.entries()) {
  if (index % 5 === 0) continue;
  row.handed_off_at = "2026-01-01T12:00:00Z";
  const process = {
    id: `process-${index}`,
    opportunity_id: row.id,
    sequence_number: 1,
    state: ["", "submitted", "offers", "contract_sent", "contract_signed"][
      index % 5
    ],
    classification: "active",
    is_unclassified_archive: false,
  };
  processes.push(process);
  if (index % 5 === 2) {
    const submission = {
      ...submissionSeed,
      id: `submission-${index}`,
      opportunity_id: row.id,
      process_id: process.id,
    };
    data.submissions.push(submission);
    data.offers.push({
      ...offerSeed,
      id: `offer-${index}`,
      submission_id: submission.id,
      opportunity_id: row.id,
      amount: 25000,
      status: "received",
      expires_at: "2027-01-01T00:00:00Z",
    });
  }
}
source.cases = buildPipelineBoard(
  data,
  processes,
  { group: "files" },
  overviewNow,
  100000,
).rows;
data.conversations = source.conversations.map((c) => ({
  ...c,
  subject: "Conversación ficticia",
  needs_attention: false,
  updated_at: null,
}));
data.messages = source.messages.map((m) => ({
  ...m,
  body: "Contenido ficticio",
}));
data.campaigns = source.campaigns.map((c) => ({ ...data.campaigns[0], ...c }));
let fail = false,
  empty = false,
  slow = false,
  boardReads = 0;
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (
    url.origin !== location.origin ||
    !["/api/pipeline-os/tasks", "/api/pipeline-os", "/api/workspace"].includes(
      url.pathname,
    )
  )
    throw new Error("FIXTURE_EXTERNAL_CALL_BLOCKED");
  if (slow) await new Promise((resolve) => setTimeout(resolve, 1200));
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (url.pathname === "/api/pipeline-os/tasks") {
    if (fail)
      return Response.json(
        { error: "Error ficticio de lectura" },
        { status: 503 },
      );
    const result = buildTasksOverview(
      source,
      parseTaskOverviewQuery(url.searchParams),
      overviewNow,
    );
    return Response.json(
      empty ? { ...result, rows: [], total: 0, hasMore: false } : result,
    );
  }
  if (url.pathname === "/api/workspace") return Response.json(data);
  boardReads++;
  const counter = document.getElementById("fixture-board-reads");
  if (counter) counter.textContent = String(boardReads);
  return Response.json(
    buildPipelineBoard(
      data,
      processes,
      parsePipelineQuery(url.searchParams),
      overviewNow,
    ),
  );
};
function Fixture() {
  const [state, setState] = useState("normal");
  return (
    <>
      <div id="fixture-tools">
        <span>QA local · datos ficticios · cero llamadas reales</span>
        <span>
          Lecturas del tablero: <output id="fixture-board-reads">0</output>
        </span>
        {["normal", "error", "empty", "slow"].map((mode) => (
          <button
            key={mode}
            aria-pressed={state === mode}
            onClick={() => {
              fail = mode === "error";
              empty = mode === "empty";
              slow = mode === "slow";
              setState(mode);
            }}
          >
            {mode}
          </button>
        ))}
      </div>
      <PipelineOSWorkspace
        initial={data}
        initialBoard={buildPipelineBoard(data, processes, {}, overviewNow)}
        processes={processes}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
