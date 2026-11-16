import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CaseProgressPanel,
  PipelineCaseProgress,
} from "../src/components/pipeline-os/case-progress";
import { PipelineMailReview } from "../src/components/pipeline-os/mail-review";
import { buildCaseProgress } from "../src/lib/pipeline-os/case-progress";
import { demoWorkspace } from "../src/lib/demo";
import { progressFixture, progressNow } from "./fixtures/case-progress";

test("AC001/011: five numbered native step controls, evidence states and labeled regions in Spanish and English", () => {
  for (const locale of ["es", "en"] as const) {
    const html = renderToStaticMarkup(
      <CaseProgressPanel
        progress={buildCaseProgress(progressFixture(), progressNow)}
        locale={locale}
        open={() => {}}
      />,
    );
    assert.equal((html.match(/aria-controls=/g) || []).length, 5);
    assert.equal((html.match(/aria-expanded="true"/g) || []).length, 1);
    assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
    assert.match(html, /role="region" aria-labelledby=/);
    assert.ok(!html.includes('type="checkbox"'));
    assert.ok(
      html.includes(
        locale === "es" ? "Oferta y negociación" : "Offer and negotiation",
      ),
    );
    assert.ok(
      html.includes(
        locale === "es"
          ? "No necesitas marcar casillas"
          : "No manual checkboxes needed",
      ),
    );
  }
});
test("AC004/009: unknown and restricted steps are explicit; sellers receive no lender-action buttons", () => {
  const s = progressFixture();
  s.documents = [];
  s.processes = [];
  let html = renderToStaticMarkup(
    <CaseProgressPanel
      progress={buildCaseProgress(s, progressNow)}
      locale="es"
      open={() => {}}
    />,
  );
  assert.ok(html.includes("Sin proceso activo asociado"));
  assert.ok(html.includes("Sin verificar"));
  assert.ok(html.includes("Revisar documentos"));
  s.profile.role = "seller";
  s.opportunity.seller_id = s.profile.id;
  html = renderToStaticMarkup(
    <CaseProgressPanel
      progress={buildCaseProgress(s, progressNow)}
      locale="es"
      open={() => {}}
    />,
  );
  assert.ok(html.includes("Acceso restringido"));
  assert.ok(!html.includes("Gestionar lenders y ofertas"));
  assert.ok(!html.includes("proceso 1"));
});
test("AC008: terminal decline shows review-closing action rather than instructions to advance funding", () => {
  const s = progressFixture();
  s.processes[0].state = "funding_declined";
  const html = renderToStaticMarkup(
    <CaseProgressPanel
      progress={buildCaseProgress(s, progressNow)}
      locale="es"
      open={() => {}}
    />,
  );
  assert.ok(html.includes("Cerrado sin financiación"));
  assert.ok(html.includes("Revisar cierre"));
  assert.ok(!html.includes("Desembolso registrado en este proceso."));
});
test("AC001/010: loading is not fake zero progress; existing mail analysis starts collapsed", () => {
  const data = demoWorkspace();
  data.demo = false;
  const html = renderToStaticMarkup(
    <PipelineCaseProgress
      data={data}
      caseId={data.opportunities[0].id}
      processes={[]}
      locale="es"
      open={() => {}}
    />,
  );
  assert.ok(html.includes('aria-busy="true"'));
  assert.ok(html.includes("Comprobando documentos"));
  assert.ok(!html.includes("0 / 5"));
  const review = renderToStaticMarkup(
    <PipelineMailReview
      caseId="fictional-case"
      locale="es"
      demo
      changed={async () => {}}
      leave={(fn) => fn()}
    />,
  );
  assert.match(review, /<details class="pos-card pos-mail-review">/);
  assert.ok(!review.includes('<details class="pos-card pos-mail-review" open'));
});
