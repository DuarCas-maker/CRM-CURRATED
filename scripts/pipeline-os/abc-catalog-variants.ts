import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { format } from "prettier";
import { oldExactBranch, sha256 } from "./abc-preflight";

export const catalogPriorPins = {
  migration: "19548594e04d95167ed23957264f25d796a0f5f02e9427c75bf1f53f4fd390aa",
  postflight:
    "c3dd51e27a1818ed821ea915ff398f16956bf13efeca6fc8cd715ab28c13f679",
  contract: "6fc8d3de046552f2f066abfb814b1929141ea2c3547d6762e0e7e1bfb820e4af",
};
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const fieldFingerprint = (value: string) => md5(JSON.stringify(value));
export const inheritedLineage: Record<string, string> = {
  "public.account_delivery_usage_before_brand_b2(uuid)":
    "public.account_delivery_usage(uuid)",
  "public.claim_notification_outbox_v15()":
    "public.claim_notification_outbox_v15()",
  "public.defer_gmail_send_before_brand_b2(uuid, integer, text)":
    "public.defer_gmail_send(uuid, integer, text)",
  "public.mark_sent_before_brand_b2(uuid, text, text)":
    "public.mark_sent(uuid, text, text)",
  "public.mark_sent_v15(uuid, text, text)":
    "public.mark_sent_v15(uuid, text, text)",
  "public.mark_sent_v19(uuid, text, text)":
    "public.mark_sent_v19(uuid, text, text)",
  "public.mark_sent_v23(uuid, text, text)":
    "public.mark_sent_v23(uuid, text, text)",
  "public.mark_sent_v37_campaign_delivery(uuid, text, text)":
    "public.mark_sent_v37_campaign_delivery(uuid, text, text)",
  "public.queue_campaign_test_before_brand_b2(uuid, uuid, text, text, text, uuid)":
    "public.queue_campaign_test(uuid, uuid, text, text, text, uuid)",
};
// Transcribed observed fingerprints from the operator's AF-FDIAG-r1 DETAIL.
// These are fingerprints of JSON field hashes, not raw prosrc/view MD5 values.
export const receivedFingerprints: Record<string, string> = {
  "public.account_delivery_usage_before_brand_b2(uuid)":
    "257e2d76ee3b7a6066e1c125fa85e79e",
  "public.claim_notification_outbox_v15()": "7cfd050e4ef6f928b03db71e60657469",
  "public.defer_gmail_send_before_brand_b2(uuid, integer, text)":
    "8045a9091a8c798f548a746683a61194",
  "public.mark_sent_before_brand_b2(uuid, text, text)":
    "118e9a13c4858b069437c9e097510655",
  "public.mark_sent_v15(uuid, text, text)": "c688c4ce9860ace9ef50cd72f5b5a457",
  "public.mark_sent_v19(uuid, text, text)": "af4619c8644868ffedf9349ecc386036",
  "public.mark_sent_v23(uuid, text, text)": "aaa32c51634ec9cbc915ce3c2a312411",
  "public.mark_sent_v37_campaign_delivery(uuid, text, text)":
    "0db9db955a8e8b9c4df43fd5e94af891",
  "public.queue_campaign_test_before_brand_b2(uuid, uuid, text, text, text, uuid)":
    "c50e11167f37afe58f68b0da964b9a1f",
  "public.campaign_workspace": "5a734e5a69aecadb8c80e418520f31e2",
  "public.mail_admin_outbox_visible": "66599ecda54bad84878efe1a5d0ab1b1",
  "public.mail_archive_visible": "7579b2bce299b70c44df758a0450c9f3",
  "public.mail_conversations_visible": "122cb1b554ee7463d38ef3ded4e9f0fb",
  "public.mail_processes_visible": "c348f896b164ff380a2c7bf81fc49285",
};
export const viewAliases: Record<string, string> = {
  "public.campaign_workspace": "c",
  "public.mail_admin_outbox_visible": "visible_admin_outbox",
  "public.mail_archive_visible": "visible_archive",
  "public.mail_conversations_visible": "visible_conversations",
  "public.mail_processes_visible": "visible_processes",
};
export function qualifyFinalView(key: string, canonical: string) {
  const alias = viewAliases[key];
  assert(alias, "Unreviewed view");
  const result = canonical
    .replace(
      /^( SELECT |    )([a-z_][a-z_0-9]*)(,|\n)/gm,
      (_m, space, column, end) => space + alias + "." + column + end,
    )
    .replace("campaign_delivery_stats(id)", "campaign_delivery_stats(c.id)");
  assert.notEqual(result, canonical, "Expected explicit qualifier delta");
  return result;
}
export type ViewReference = { key: string; definition: string };
export function deriveCatalogVariants(prior: any, views: ViewReference[]) {
  const inherited: Record<string, string[]> = {};
  const viewVariants: Record<string, string[]> = {};
  for (const [key, base] of Object.entries(inheritedLineage)) {
    const variants: string[] = prior.sourceVariants[base];
    assert(!prior.postSourceVariants[key], "Already has a post source variant");
    assert(variants.includes(prior.post.functions[key].sourceHash));
    assert(variants.includes(prior.pre.functions[base].sourceHash));
    assert(
      variants.some((v) => fieldFingerprint(v) === receivedFingerprints[key]),
      "Inherited observation mismatch",
    );
    inherited[key] = [...variants];
  }
  assert.deepEqual(
    views.map((v) => v.key).sort(),
    Object.keys(viewAliases).sort(),
  );
  for (const row of views) {
    const canonicalHash = md5(row.definition);
    assert.equal(
      canonicalHash,
      prior.post.relations[row.key].viewHash,
      "Wrong canonical view source",
    );
    const qualifiedHash = md5(qualifyFinalView(row.key, row.definition));
    assert.equal(
      fieldFingerprint(qualifiedHash),
      receivedFingerprints[row.key],
      "Qualified view differs from operator evidence",
    );
    assert(
      prior.changed.relations.includes(row.key),
      "Do not expand protected scope",
    );
    viewVariants[row.key] = [canonicalHash, qualifiedHash];
  }
  return { inherited, viewVariants };
}
export const catalogViewBranch = `elsif mode='post' and g='relations' and v<>'null'::jsonb
 and (a-'viewHash') is not distinct from (v-'viewHash')
 and coalesce((d->'postViewVariants'->k)?(a->>'viewHash'),false) then null;
 `;
type Artifacts = { migration: string; postflight: string; contract: string };
const embedded = (d: any) =>
  "'" + JSON.stringify(d).replaceAll("'", "''") + "'::jsonb";
function replaceBindings(
  text: string,
  before: Artifacts,
  after: Artifacts,
  copies: number,
) {
  const oldJson = embedded(JSON.parse(before.contract)),
    newJson = embedded(JSON.parse(after.contract));
  assert.equal(text.split(oldJson).length - 1, copies);
  return text
    .replaceAll(oldJson, newJson)
    .replaceAll(sha256(before.contract), sha256(after.contract));
}
export async function reviseCatalogArtifacts(
  prior: Artifacts,
  views: ViewReference[],
) {
  for (const kind of ["migration", "postflight", "contract"] as const)
    assert.equal(sha256(prior[kind]), catalogPriorPins[kind]);
  const before = JSON.parse(prior.contract);
  const variants = deriveCatalogVariants(before, views);
  const next = {
    ...before,
    postSourceVariants: { ...before.postSourceVariants, ...variants.inherited },
    postInheritedSourceLineage: inheritedLineage,
    postViewVariants: variants.viewVariants,
  };
  const after: Artifacts = {
    migration: "",
    postflight: "",
    contract: await format(JSON.stringify(next), { parser: "json" }),
  };
  const boundMigration = replaceBindings(prior.migration, prior, after, 2);
  const start = boundMigration.lastIndexOf("do $af_check$");
  assert(start > 0);
  const tail = boundMigration.slice(start);
  assert.equal(tail.split(oldExactBranch).length - 1, 1);
  after.migration =
    boundMigration.slice(0, start) +
    tail.replace(oldExactBranch, catalogViewBranch + oldExactBranch);
  const post = replaceBindings(prior.postflight, prior, after, 1);
  assert.equal(post.split(oldExactBranch).length - 1, 1);
  after.postflight = post.replace(
    oldExactBranch,
    catalogViewBranch + oldExactBranch,
  );
  const restored = await restoreCatalogPrior(after);
  for (const kind of ["migration", "postflight", "contract"] as const)
    assert.equal(sha256(restored[kind]), sha256(prior[kind]));
  return after;
}

/** Historical QA retains its original revision; current QA uses current files. */
export async function restoreCatalogPrior(
  current: Artifacts,
): Promise<Artifacts> {
  const d = JSON.parse(current.contract);
  if (!d.postInheritedSourceLineage) {
    for (const kind of ["migration", "postflight", "contract"] as const)
      assert.equal(sha256(current[kind]), catalogPriorPins[kind]);
    return current;
  }
  assert.deepEqual(d.postInheritedSourceLineage, inheritedLineage);
  for (const key of Object.keys(inheritedLineage))
    delete d.postSourceVariants[key];
  delete d.postInheritedSourceLineage;
  delete d.postViewVariants;
  const prior: Artifacts = {
    migration: "",
    postflight: "",
    contract: await format(JSON.stringify(d), { parser: "json" }),
  };
  for (const [kind, copies] of [
    ["migration", 2],
    ["postflight", 1],
  ] as const) {
    assert.equal(current[kind].split(catalogViewBranch).length - 1, 1);
    prior[kind] = replaceBindings(
      current[kind],
      current,
      prior,
      copies,
    ).replace(catalogViewBranch, "");
  }
  for (const kind of ["migration", "postflight", "contract"] as const)
    assert.equal(
      sha256(prior[kind]),
      catalogPriorPins[kind],
      "Unexpected delta outside catalog variants",
    );
  return prior;
}
