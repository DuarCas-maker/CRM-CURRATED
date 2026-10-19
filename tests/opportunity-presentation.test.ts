import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Activity, Locale } from "../src/lib/domain";
import { groupDocumentActivities } from "../src/lib/activity-groups";
import { demoWorkspace } from "../src/lib/demo";
import { UnderwritingChecklist } from "../src/components/underwriting-readiness";
import { UnderwritingNotices } from "../src/components/underwriting-notices";

// Styles are handled by Next.js in the browser. Ignore them only while loading
// the shared case component for these server-rendered presentation checks.
const cssHook = registerHooks({
  load(url, context, nextLoad) {
    return url.endsWith(".css")
      ? { format: "module", source: "", shortCircuit: true }
      : nextLoad(url, context);
  },
});
const { OpportunityDetail } =
  await import("../src/components/opportunity-detail");
cssHook.deregister();

function review(
  id: string,
  minute: number,
  extra: Partial<Activity> = {},
): Activity {
  return {
    id,
    opportunity_id: "case",
    actor_id: "reviewer",
    type: "document",
    area: "seller",
    body: `Statement ${id}: approved`,
    created_at: new Date(Date.UTC(2026, 9, 19, 12, minute)).toISOString(),
    ...extra,
  };
}

test("document reviews group consecutively up to 20 minutes apart without changing the audit events", () => {
  const events = [
    review("1", 0),
    review("2", 20, {
      actor_id: "second-reviewer",
      body: "Application: correction — Signature missing",
    }),
    review("3", 40, { type: "review_document", body: "Application: received" }),
    review("4", 61),
  ];
  const before = structuredClone(events);
  const groups = groupDocumentActivities(events);
  assert.deepEqual(
    groups.map((group) => group.events.map((event) => event.id)),
    [["4"], ["3", "2", "1"]],
  );
  assert.equal(groups[1].events[1], events[1]);
  assert.deepEqual(events, before);
});

test("all document event types group regardless of wording, language or recorded actor", () => {
  for (const extra of [
    { type: "document", body: "Document received; review required" },
    { type: "document", body: "Documento recibido; requiere revisión" },
    { type: "document", body: "Unknown document event", actor_id: "" },
    { type: "application", body: "Signed application received", actor_id: "" },
    { type: "review_document" },
    { type: "receive_document" },
    { type: "receive_upload_demo" },
    { type: "incorporate_document" },
    { type: "upload_demo" },
    { type: "initialize_document_checklist" },
    { type: "company_application_generated" },
  ]) {
    const events = [
      review("1", 0),
      review("middle", 5, extra),
      review("2", 10),
    ];
    const groups = groupDocumentActivities(events);
    assert.equal(groups.length, 1, JSON.stringify(extra));
    assert.deepEqual(groups[0].events, [events[2], events[1], events[0]]);
  }
});

test("the mixed document receipts and approvals from the reported timeline form collapsed bursts", () => {
  const events = [
    review("approval", 27, { body: "Signed application: approved" }),
    review("receipt", 25, { body: "Document received; review required" }),
    review("receipt2", 21, { body: "Document received; review required" }),
    review("tax", 21, { body: "Corporate tax return: approved" }),
    review("previous1", 0, {
      created_at: "2026-10-18T21:59:00Z",
      body: "Document received; review required",
    }),
    review("previous2", 0, {
      created_at: "2026-10-18T21:59:00Z",
      body: "Bank statement: approved",
    }),
  ];
  assert.deepEqual(
    groupDocumentActivities(events).map((group) =>
      group.events.map((event) => event.id),
    ),
    [
      ["approval", "receipt", "receipt2", "tax"],
      ["previous1", "previous2"],
    ],
  );
});

test("messages, human notes and unrelated actions or cases interrupt document activity groups", () => {
  for (const extra of [
    { type: "email", body: "Human message: approved" },
    { type: "note", body: "Human note: approved" },
    { type: "call" },
    { type: "analysis" },
    { type: "created" },
    { type: "status" },
    { type: "task" },
    { opportunity_id: "other-case" },
  ]) {
    const groups = groupDocumentActivities([
      review("1", 0),
      review("middle", 5, extra),
      review("2", 10),
    ]);
    assert.equal(groups.length, 3, JSON.stringify(extra));
  }
  assert.equal(
    groupDocumentActivities([
      review("1", 0),
      review("2", 20, { created_at: "2026-10-19T12:20:00.001Z" }),
    ]).length,
    2,
  );
  assert.equal(
    groupDocumentActivities([
      review("1", 0),
      review("2", 0, { created_at: "invalid" }),
    ]).length,
    2,
  );
});

function caseMarkup(
  initialTab: "documents" | "analysis" | "activity",
  locale: Locale,
  embedded = false,
) {
  const data = demoWorkspace();
  const opportunity = { ...data.opportunities[0], handed_off_at: null };
  data.opportunities[0] = opportunity;
  data.documents = [
    { id: "app", name: "Application file", kind: "application" },
    { id: "extra", name: "Tax return", kind: "additional" },
    {
      id: "bank1",
      name: "Bank Statement 1",
      kind: "bank_statement",
      bank_name: "Other documents",
    },
    {
      id: "bank2",
      name: "Bank Statement 2",
      kind: "bank_statement",
      bank_name: "Other documents",
    },
    {
      id: "bank3",
      name: "Bank Statement 1",
      kind: "bank_statement",
      bank_name: "Second Bank",
    },
  ].map((doc) => ({
    ...doc,
    opportunity_id: opportunity.id,
    period: "",
    source: "upload",
    status: "approved" as const,
    created_at: "2026-10-19T12:00:00Z",
    storage_path: `${doc.id}.pdf`,
  }));
  data.analyses = [
    {
      id: "analysis",
      opportunity_id: opportunity.id,
      summary: "Team summary fixture",
      conclusion: "Team conclusion fixture",
      observations: "Team observation fixture",
      recommendations: "Team recommendation fixture",
      reviewer_id: data.profile.id,
      reviewed_at: "2026-10-19T12:00:00Z",
    },
  ];
  data.activities = [
    review("1", 0, {
      opportunity_id: opportunity.id,
      actor_id: data.profiles[1].id,
    }),
    review("receipt", 10, {
      opportunity_id: opportunity.id,
      body: "Document received; review required",
    }),
    review("2", 20, {
      opportunity_id: opportunity.id,
      actor_id: data.profiles[2].id,
      body: "Application: correction — Human review details",
    }),
    review("note", 25, {
      opportunity_id: opportunity.id,
      type: "note",
      body: "Human note stays visible",
    }),
  ];
  data.messages = [];
  return renderToStaticMarkup(
    createElement(OpportunityDetail, {
      opportunity,
      data,
      profile: data.profile,
      locale,
      initialTab,
      embedded,
      busy: false,
      act: async () => undefined,
      refresh: async () => {},
      back: () => {},
    }),
  );
}

test("both shared case views separate applications, extra files and banks without changing received or approved counts", () => {
  for (const embedded of [false, true])
    for (const locale of ["es", "en"] as const) {
      const html = caseMarkup("documents", locale, embedded);
      const sections = [
        ...html.matchAll(
          /<section class="document-bank-group">([\s\S]*?)<\/section>/g,
        ),
      ].map((match) => match[1]);
      assert.equal(sections.length, 4);
      assert.match(
        sections[0],
        locale === "es" ? /<h3>Aplicación<\/h3>/ : /<h3>Application<\/h3>/,
      );
      assert(!sections[0].includes("Tax return"));
      assert.match(sections[1], /Tax return/);
      assert(!sections[1].includes("Bank Statement"));
      assert.match(
        sections[2],
        locale === "es" ? /Extracto bancario 1/ : /Bank Statement 1/,
      );
      assert.match(
        sections[2],
        locale === "es" ? /Extracto bancario 2/ : /Bank Statement 2/,
      );
      assert.match(sections[3], /Second Bank/);
      assert.match(
        html,
        locale === "es"
          ? /3\/4 extractos recibidos/
          : /3\/4 statements received/,
      );
      assert.match(html, locale === "es" ? /3\/4 aprobados/ : /3\/4 approved/);
    }
});

test("manual team review is first in both shared views and AI underwriting remains available", () => {
  for (const embedded of [false, true])
    for (const locale of ["es", "en"] as const) {
      const html = caseMarkup("analysis", locale, embedded);
      assert.match(html, /Team summary fixture/);
      assert.match(html, /Team conclusion fixture/);
      assert.match(html, /Team observation fixture/);
      assert.match(html, /Team recommendation fixture/);
      const aiHeading =
        locale === "es"
          ? "Análisis de documentos con IA"
          : "AI document analysis";
      assert(html.indexOf("Team summary fixture") < html.indexOf(aiHeading));
      assert.match(html, /class="underwriting-checklist" open=""/);
      assert.match(html, /<details class="underwriting-notices"><summary>/);
    }
});

test("review groups start closed, keep original details and leave human notes outside the group", () => {
  for (const embedded of [false, true])
    for (const locale of ["es", "en"] as const) {
      const html = caseMarkup("activity", locale, embedded);
      const group = html.match(
        /<details class="timeline-event-group">([\s\S]*?)<\/details>/,
      );
      assert(group);
      assert.match(group[1], locale === "es" ? /3 eventos/ : /3 events/);
      assert.match(
        group[1],
        locale === "es" ? /Actividad documental/ : /Document activity/,
      );
      assert.match(group[1], /Document received; review required/);
      assert.match(group[1], /Human review details/);
      assert.match(group[1], /Sofia Rivera/);
      assert.match(group[1], /Daniel Brooks/);
      assert.match(group[1], /2026-10-19T12:00:00.000Z/);
      assert.match(group[1], /2026-10-19T12:20:00.000Z/);
      assert(!group[1].includes("Human note stays visible"));
      assert.match(
        html.slice(
          html.indexOf('class="timeline"'),
          html.indexOf('<details class="timeline-event-group">'),
        ),
        /Human note stays visible/,
      );
    }
});

test("checklist starts expanded and errors have their own closed disclosure in both languages", () => {
  for (const locale of ["es", "en"] as const) {
    const checklist = renderToStaticMarkup(
      createElement(UnderwritingChecklist, { documents: [], locale }),
    );
    assert.match(
      checklist,
      /<details class="underwriting-checklist" open=""[^>]*>/,
    );
    assert.match(checklist, /<summary/);
    const notices = renderToStaticMarkup(
      createElement(UnderwritingNotices, {
        locale,
        error: "Error fixture",
        messages: ["Warning fixture"],
      }),
    );
    assert.match(notices, /<details class="underwriting-notices"><summary>/);
    assert.match(notices, /Error fixture/);
    assert.match(notices, /Warning fixture/);
    assert(!notices.includes('open=""'));
    assert.equal(
      renderToStaticMarkup(createElement(UnderwritingNotices, { locale })),
      "",
    );
  }
});
