import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultFundingModel,
  fundingValues,
  groupIncomeRows,
  parseMonthlyIncome,
} from "../src/lib/funding-options";
import { campaignPresets, fundingPreset } from "../src/lib/campaign-presets";
import {
  campaignTemplateSchema,
  templatePreviewValues,
} from "../src/lib/campaign-templates";
import { renderCampaignContent } from "../src/lib/campaign-content";
import { renderTemplate } from "../src/lib/domain";
import { detectMapping, normalizeRow } from "../src/lib/imports";

test("approved USD scenarios and cent rounding", () => {
  const v = fundingValues(defaultFundingModel, 100000, "sender@example.test");
  assert.equal(v.funding_amount_6, "$100,000.00");
  assert.equal(v.funding_amount_9, "$200,000.00");
  assert.equal(v.funding_amount_12, "$300,000.00");
  assert.equal(v.funding_payment_6, "$5,000.00");
  assert.equal(v.funding_payment_9, "$6,923.08");
  assert.equal(v.funding_payment_12, "$8,076.92");
  assert.equal(
    fundingValues(defaultFundingModel, 0.01, "sender@example.test")
      .funding_payment_6,
    "$0.00",
  );
});
test("parameters are editable without changing defaults", () => {
  const cfg = structuredClone(defaultFundingModel);
  cfg.options[0] = { months: 6, multiplier: 1.1, factor: 1.3, weeks: 26 };
  assert.equal(
    fundingValues(cfg, 100000, "sender@example.test").funding_payment_6,
    "$5,500.00",
  );
  assert.equal(defaultFundingModel.options[0].multiplier, 1);
});
for (const value of [
  "",
  null,
  0,
  -1,
  "1.000,00",
  "10-20k",
  "=100*2",
  "NaN",
  Infinity,
  "1,00",
  "100.001",
  1000000001,
])
  test(`reject invalid income ${String(value)}`, () =>
    assert.equal(parseMonthlyIncome(value), null));
test("reference option amounts reproduce weekly estimates", () => {
  const cfg = structuredClone(defaultFundingModel);
  cfg.options[0].multiplier = 1.1;
  cfg.options[1].multiplier = 2.15;
  cfg.options[2].multiplier = 3.2;
  const v = fundingValues(cfg, 100000, "sender@example.test");
  assert.equal(v.funding_payment_6, "$5,500.00");
  assert.equal(v.funding_payment_9, "$7,442.31");
  assert.equal(v.funding_payment_12, "$8,615.38");
});
test("USD strings are parsed explicitly", () => {
  assert.equal(parseMonthlyIncome("USD $12,345.67"), 12345.67);
  assert.equal(parseMonthlyIncome("100000.50"), 100000.5);
});
test("unique normalized emails and conflicts", () => {
  const r = groupIncomeRows([
    { email: " A@example.test ", income: 100 },
    { email: "a@example.test", income: 100 },
    { email: "b@example.test", income: 200 },
    { email: "B@example.test", income: 300 },
    { email: "c@example.test", income: "bad" },
  ]);
  assert.deepEqual(r.accepted, [
    { email: "a@example.test", monthly_income: 100 },
  ]);
  assert.deepEqual(r.conflicts, ["b@example.test"]);
  assert.equal(r.invalid, 1);
});
test("income is optional for existing import mappings", () => {
  const mapping = detectMapping([
    "Email",
    "Full Name",
    "Business Name",
    "Monthly Income",
  ]);
  assert.equal(mapping.monthly_income, "Monthly Income");
  const row = normalizeRow(
    { Email: " A@example.test ", "Monthly Income": "$12,345.67" },
    mapping,
  );
  assert.equal(row.valid, true);
  if (row.valid) {
    assert.equal(row.email, "a@example.test");
    assert.equal(row.monthly_income, 12345.67);
  }
});
test("reference preset is safe, dynamic and has no static sender", () => {
  const p = fundingPreset;
  campaignTemplateSchema.parse(p);
  const values = {
    ...templatePreviewValues(defaultFundingModel, "sender@example.test"),
    name: '<img src=x onerror="x">',
    company: "Example & Sons",
  };
  const rendered = renderCampaignContent(p.body, values, "markdown");
  assert.match(
    renderTemplate(p.subject, values),
    /\$200,000.00.*Example & Sons/,
  );
  assert.match(rendered.html, /mailto:sender@example.test/);
  assert.match(rendered.html, /&lt;img/);
  assert.doesNotMatch(rendered.html, /<img/);
  assert.match(rendered.html, /<table/);
  assert.match(rendered.html, /#102d4d/);
  assert.doesNotMatch(rendered.html, /\{\{|Daniel|Santino/);
});
test("missing income, invalid config and sender injection fail closed", () => {
  assert.throws(() =>
    fundingValues(defaultFundingModel, null, "sender@example.test"),
  );
  assert.throws(() =>
    fundingValues(
      { ...defaultFundingModel, version: 2 },
      100,
      "sender@example.test",
    ),
  );
  assert.throws(() =>
    fundingValues(
      defaultFundingModel,
      100,
      "sender@example.test?bcc=other@example.test",
    ),
  );
  const p = campaignPresets.find((p) => "funding_model" in p)!;
  assert.throws(() =>
    campaignTemplateSchema.parse({ ...p, funding_model: null }),
  );
});
test("legacy formatted templates still render unchanged", () => {
  const p = campaignPresets.find((p) => !("funding_model" in p))!;
  const r = renderCampaignContent(
    p.body,
    templatePreviewValues(null),
    p.body_format,
  );
  assert.doesNotMatch(r.html, /max-width:560px/);
  assert.match(r.html, /\$350,000/);
});
