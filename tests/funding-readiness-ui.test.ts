import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  IncomeOverview,
  IncomeSelector,
  IncomeStatus,
} from "../src/components/pipeline-os/campaign-income";
import { CampaignTemplateReadiness } from "../src/components/pipeline-os/campaign-template-readiness";
import { FlowComposer } from "../src/components/pipeline-os/campaign-flow-composer";
import { pipelineModuleDemo } from "../src/lib/pipeline-os/demo";
import { fundingPreset } from "../src/lib/campaign-presets";
import { randomUUID } from "node:crypto";

test("income missing is explicit, unknown is not presented as missing, counters keep separate scopes", () => {
  const missing = renderToStaticMarkup(
    createElement(IncomeStatus, { value: null, locale: "es" }),
  );
  assert.match(missing, /Sin ingreso mensual/);
  assert.match(missing, /data-income="missing"/);
  assert.match(
    renderToStaticMarkup(
      createElement(IncomeStatus, { value: 100000, locale: "es" }),
    ),
    /\$100,000.00/,
  );
  assert.match(
    renderToStaticMarkup(
      createElement(IncomeStatus, { value: undefined, locale: "es" }),
    ),
    /Ingreso sin consultar/,
  );
  const summary = renderToStaticMarkup(
    createElement(IncomeOverview, {
      locale: "es",
      summary: {
        all: { with_income: 2052, without_income: 1978 },
        available: { with_income: 20, without_income: 30 },
      },
    }),
  );
  assert.match(summary, /2.052/);
  assert.match(summary, /1.978/);
  assert.match(summary, /Disponibles/);
  assert.match(
    renderToStaticMarkup(
      createElement(IncomeSelector, {
        locale: "es",
        value: "all",
        change() {},
      }),
    ),
    /value="all" selected/,
  );
});
test("missing records are shown by identity and fields; selection is not silently reduced", () => {
  const html = renderToStaticMarkup(
    createElement(CampaignTemplateReadiness, {
      locale: "es",
      retry() {},
      review: {
        template_version: 1,
        checked_count: 2,
        ready_count: 1,
        attention_count: 1,
        rows: [
          {
            contact_id: randomUUID(),
            name: "Example contact",
            company: "Example <script>",
            email: "missing@example.test",
            monthly_income: null,
            ready: false,
            reason: "missing_data",
            missing_fields: ["monthly_income", "company"],
          },
          {
            contact_id: randomUUID(),
            name: "Ready",
            company: "Ready Business",
            email: "ready@example.test",
            monthly_income: 1000,
            ready: true,
            reason: "eligible",
            missing_fields: [],
          },
        ],
      },
    }),
  );
  assert.match(html, /missing@example.test/);
  assert.match(html, /Ingreso mensual, Empresa/);
  assert.doesNotMatch(html, /ready@example.test|<script>/);
  assert.match(html, /Tu selección se conserva/);
  assert.match(html, /&lt;script&gt;/);
});
test("composer cannot schedule while the selected real records have not been reviewed", () => {
  const { data } = pipelineModuleDemo();
  data.demo = false;
  data.accounts = [
    {
      ...data.accounts[0],
      id: randomUUID(),
      email: "sender@example.test",
      status: "connected",
      brand_context: { can_campaign: true },
    } as any,
  ];
  data.email_templates = [
    {
      ...fundingPreset,
      id: randomUUID(),
      version: 1,
      archived_at: null,
      updated_at: new Date().toISOString(),
    },
  ];
  const html = renderToStaticMarkup(
    createElement(FlowComposer, {
      data,
      locale: "es",
      contactIds: [randomUUID()],
      close() {},
      done: async () => {},
    }),
  );
  assert.match(html, /Datos reales del lote/);
  assert.match(html, /Revisando datos de los leads/);
  const submit = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0];
  assert(submit);
  assert.match(submit, /disabled/);
  assert.match(html, /VISTA PREVIA/);
  assert.match(html, /\$200,000.00/);
});
