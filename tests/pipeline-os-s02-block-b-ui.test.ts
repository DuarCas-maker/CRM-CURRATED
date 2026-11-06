import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  BrandSettingsView,
  BrandConnectionFieldsView,
  brandRequest,
} from "../src/components/brand-settings";
import {
  parseBrandCommand,
  parseBrandOAuthIntent,
  parseBrandPage,
  brandErrorText,
  type BrandRow,
} from "../src/lib/brand-management";

const brand: BrandRow = {
  key: randomUUID(),
  id: randomUUID(),
  code: "CURATED",
  name: "Marca de prueba con nombre largo",
  active: true,
  revision: 1,
};
const noop = () => {};
test("B1 panel renders empty/loading/error/read-only states in ES/EN without mutation controls", () => {
  for (const locale of ["es", "en"] as const) {
    const props = {
      locale,
      admin: false,
      collection: "brands" as const,
      rows: [],
      more: false,
      onCollection: noop,
      onMore: noop,
    };
    const empty = renderToStaticMarkup(
      h(BrandSettingsView, { ...props, loading: false, error: "" }),
    );
    assert.match(empty, locale === "es" ? /No hay registros/ : /No records/);
    assert.doesNotMatch(
      empty,
      /Account brand reviews|Asociaciones por revisar/,
    );
    const loading = renderToStaticMarkup(
      h(BrandSettingsView, { ...props, loading: true, error: "" }),
    );
    assert.match(loading, /role="status"/);
    assert.match(loading, /aria-busy="true"/);
    const error = renderToStaticMarkup(
      h(BrandSettingsView, {
        ...props,
        loading: false,
        error: "private SQL internal detail",
      }),
    );
    assert.match(error, /role="alert"/);
    assert.doesNotMatch(error, /private SQL internal detail/);
  }
});
test("B1 bounded catalog UI renders 0, 1 and 200 rows, load-more and impact counts", () => {
  for (const count of [0, 1, 200]) {
    const html = renderToStaticMarkup(
      h(BrandSettingsView, {
        locale: "es",
        admin: true,
        loading: false,
        error: "",
        collection: "brands",
        rows: Array.from({ length: count }, (_, i) => ({
          ...brand,
          key: String(i),
        })),
        more: count === 200,
        onCollection: noop,
        onMore: noop,
      }),
    );
    assert.equal((html.match(/<li>/g) || []).length, count);
    if (count === 200) assert.match(html, /Cargar más/);
  }
  const html = renderToStaticMarkup(
    h(BrandSettingsView, {
      locale: "en",
      admin: true,
      loading: false,
      error: "",
      collection: "reviews",
      rows: [
        {
          key: "fixture",
          account_email: "qa@example.test",
          status: "conflict",
          impact: { queued: 2, sending: 1, uncertain: 1, active_campaigns: 3 },
        },
      ],
      more: false,
      onCollection: noop,
      onMore: noop,
    }),
  );
  assert.match(html, /Queued \/ sending \/ uncertain/);
  assert.match(html, /2\/1\/1\/3/);
});
test("OAuth fields never silently select a brand; closed while missing/disabled/loading/error", () => {
  for (const props of [
    { brands: [] },
    { brands: [brand] },
    { brands: [brand], disabled: true },
    { brands: [brand], loading: true },
    { brands: [brand], error: "BRAND_UNAVAILABLE" },
  ]) {
    const html = renderToStaticMarkup(
      h(BrandConnectionFieldsView, {
        locale: "es",
        accounts: [],
        loading: false,
        error: "",
        ...props,
      }),
    );
    assert.match(html, /<option value="" selected="">/);
    assert.match(html, /<button type="submit" class="button" disabled=""/);
    assert.match(html, /name="brand_id" value=""/);
  }
});
test("request identity is retained on same-payload retry and rotated on changed mutation", () => {
  const first = brandRequest(null, "brand_update", { name: "A" }, () =>
    randomUUID(),
  );
  const retry = brandRequest(first, "brand_update", { name: "A" }, () => {
    throw new Error("must reuse");
  });
  assert.equal(first.key, retry.key);
  assert.notEqual(
    brandRequest(first, "brand_update", { name: "B" }, randomUUID).key,
    first.key,
  );
  assert.notEqual(
    brandRequest(first, "brand_create", { name: "A" }, randomUUID).key,
    first.key,
  );
});
test("B1 parsers reject spoofed metadata, unknown operations, unsafe revisions and historical intervals", () => {
  assert.equal(
    parseBrandCommand("brand_create", {
      code: "A",
      name: "A",
      actor_id: randomUUID(),
    }),
    null,
  );
  assert.equal(parseBrandCommand("brand_unknown", {}), null);
  assert.equal(
    parseBrandCommand("brand_update", {
      brand_id: brand.id,
      name: "A",
      expected_revision: Number.MAX_SAFE_INTEGER + 1,
    }),
    null,
  );
  assert.equal(
    parseBrandCommand("brand_mapping_propose", {
      account_id: randomUUID(),
      proposed_brand_id: brand.id,
      expected_account_revision: 0,
      history_approved: true,
    }),
    null,
  );
  assert.equal(
    parseBrandCommand("brand_mapping_propose", {
      account_id: randomUUID(),
      proposed_brand_id: brand.id,
      expected_account_revision: 0,
      review_id: randomUUID(),
    }),
    null,
  );
  assert.equal(
    parseBrandOAuthIntent({
      mode: "new",
      brand_id: brand.id,
      expected_brand_revision: 1,
      account_id: randomUUID(),
    }),
    null,
  );
  assert.equal(
    parseBrandPage("brands", {
      items: [{ ...brand, revision: 0 }],
      next_cursor: null,
      is_admin: true,
    }),
    null,
  );
  assert.equal(
    brandErrorText("untrusted detail", "en"),
    "Brand administration is unavailable.",
  );
});
test("both OAuth forms reuse brand fields; transport, Instantly and existing access UI remain separate", async () => {
  for (const path of [
    "src/components/gmail-history.tsx",
    "src/components/crm.tsx",
  ])
    assert.match(await readFile(path, "utf8"), /<BrandConnectionFields/);
  const config = await readFile("src/components/integrations.tsx", "utf8");
  assert.match(config, /<BrandSettings/);
  assert.match(config, /<InstantlyTrialControl/);
  assert.match(config, /Sender permissions/);
});
