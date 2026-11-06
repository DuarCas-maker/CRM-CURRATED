import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { format } from "prettier";

const md5 = (text: string) => createHash("md5").update(text).digest("hex");
/** Refuse to treat newlines inside SQL values/identifiers as mere formatting. */
export function multilineQuotedTokens(source: string): number {
  let i = 0,
    count = 0;
  while (i < source.length) {
    if (source.startsWith("--", i)) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (source.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      assert.equal(depth, 0, "Unclosed comment");
      continue;
    }
    const dollar = source
      .slice(i)
      .match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
    if (dollar) {
      const end = source.indexOf(dollar, i + dollar.length);
      assert(end >= 0, "Unclosed dollar literal");
      if (/[\r\n]/.test(source.slice(i + dollar.length, end))) count++;
      i = end + dollar.length;
      continue;
    }
    if (source[i] === "'" || source[i] === '"') {
      const quote = source[i],
        start = i;
      const escaped =
        quote === "'" &&
        i > 0 &&
        /[eE]/.test(source[i - 1]) &&
        (i < 2 || !/[A-Za-z0-9_$]/.test(source[i - 2]));
      let closed = false;
      i++;
      while (i < source.length) {
        if (escaped && source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          if (source[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      assert(closed, "Unclosed quoted token");
      if (/[\r\n]/.test(source.slice(start, i))) count++;
      continue;
    }
    i++;
  }
  return count;
}

export type SourceObservation = {
  key: string;
  source: string;
  expectedHash: string;
  crlfHash: string;
};
export function derivePostVariants(observations: SourceObservation[]) {
  const variants: Record<string, string[]> = {};
  for (const row of [...observations].sort((a, b) =>
    a.key.localeCompare(b.key),
  )) {
    assert(!Object.hasOwn(variants, row.key), "Duplicate function");
    assert.equal(
      md5(row.source),
      row.expectedHash,
      "Unexpected canonical source",
    );
    assert.equal(
      multilineQuotedTokens(row.source),
      0,
      "Multiline quoted content requires separate review",
    );
    const lf = row.source.replaceAll("\r\n", "\n");
    assert(!lf.includes("\r"), "Bare CR is unsupported");
    assert.equal(
      md5(lf),
      row.expectedHash,
      "Only canonical LF source is eligible",
    );
    assert.equal(
      md5(lf.replaceAll("\n", "\r\n")),
      row.crlfHash,
      "Observed CRLF source is not a whole-body EOL transform",
    );
    assert.notEqual(row.expectedHash, row.crlfHash, "No variant needed");
    assert(
      /^[a-f0-9]{32}$/.test(row.expectedHash) &&
        /^[a-f0-9]{32}$/.test(row.crlfHash),
    );
    variants[row.key] = [row.expectedHash, row.crlfHash];
  }
  return variants;
}
export const previousSourceSetSql =
  "case when mode='pre' then d->'sourceVariants'->k else jsonb_build_array(v->>'sourceHash') end";
export const revisedSourceSetSql =
  "case when mode='pre' then d->'sourceVariants'->k else coalesce(d->'postSourceVariants'->k,jsonb_build_array(v->>'sourceHash')) end";

export const previousUntouchedSql =
  "(select jsonb_object_agg(e.key,e.value-coalesce(array(select jsonb_array_elements_text(d->'changed'->e.key)),array[]::text[])) from jsonb_each(observed) e)";
export const revisedUntouchedSql =
  "(select jsonb_object_agg(e.key,(case when e.key='functions' then (select coalesce(jsonb_object_agg(f.key,case when coalesce((d->'protectedSourceVariants'->f.key)?(f.value->>'sourceHash'),false) then jsonb_set(f.value,'{sourceHash}',d->'protectedSourceVariants'->f.key->0,false) else f.value end),'{}'::jsonb) from jsonb_each(e.value) f) else e.value end)-coalesce(array(select jsonb_array_elements_text(d->'changed'->e.key)),array[]::text[])) from jsonb_each(observed) e)";
export async function reviseSourceArtifacts(
  prior: { migration: string; postflight: string; contract: string },
  variants: Record<string, string[]>,
  protectedVariants: Record<string, string[]>,
) {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  assert.equal(
    sha(prior.migration),
    "e4626cb612868f4cd13ebce98ca3a6b5fea0e51f7d73b05f0e4935dd3be0b604",
  );
  assert.equal(
    sha(prior.postflight),
    "bae5b6653aee9eeb928e1ee1079adf52a7492bd9065595e40c67de5f74088e10",
  );
  assert.equal(
    sha(prior.contract),
    "8fafee3c08c3aea1941b91058fcc9594560d280ede7b66724583b5167f932321",
  );
  const before = JSON.parse(prior.contract);
  assert.equal(Object.keys(variants).length, 117);
  for (const [key, values] of Object.entries(variants)) {
    assert(
      before.post.functions[key] &&
        values.length === 2 &&
        new Set(values).size === 2,
    );
    assert(values.every((v) => /^[a-f0-9]{32}$/.test(v)));
    assert.equal(values[0], before.post.functions[key].sourceHash);
  }
  assert.deepEqual(Object.keys(protectedVariants).sort(), [
    "public.campaign_contact_summary(uuid)",
    "public.campaign_contacts_page(uuid, text, text, integer)",
  ]);
  for (const [key, values] of Object.entries(protectedVariants)) {
    assert(
      !before.changed.functions.includes(key) &&
        values.length === 2 &&
        new Set(values).size === 2,
    );
    assert(values.every((v) => /^[a-f0-9]{32}$/.test(v)));
  }
  const after = {
    ...before,
    postSourceVariants: variants,
    protectedSourceVariants: protectedVariants,
  };
  const contract = await format(JSON.stringify(after), { parser: "json" }),
    oldSha = sha(prior.contract),
    newSha = sha(contract);
  const quote = (v: string) => "'" + v.replaceAll("'", "''") + "'::jsonb";
  const oldEmbedded = quote(JSON.stringify(before)),
    newEmbedded = quote(JSON.stringify(after));
  const patch = (
    text: string,
    expectedEmbeddings: number,
    expectedComparisons: number,
  ) => {
    assert.equal(text.split(oldEmbedded).length - 1, expectedEmbeddings);
    assert.equal(
      text.split(previousSourceSetSql).length - 1,
      expectedComparisons,
    );
    const expectedProtected = expectedEmbeddings === 2 ? 2 : 1;
    assert.equal(
      text.split(previousUntouchedSql).length - 1,
      expectedProtected,
    );
    const next = text
      .replaceAll(oldEmbedded, newEmbedded)
      .replaceAll(oldSha, newSha)
      .replaceAll(previousSourceSetSql, revisedSourceSetSql)
      .replaceAll(previousUntouchedSql, revisedUntouchedSql);
    assert.equal(
      next
        .replaceAll(newEmbedded, oldEmbedded)
        .replaceAll(newSha, oldSha)
        .replaceAll(revisedSourceSetSql, previousSourceSetSql),
      text.replaceAll(previousUntouchedSql, revisedUntouchedSql),
    );
    return next;
  };
  return {
    contract,
    migration: patch(prior.migration, 2, 3),
    postflight: patch(prior.postflight, 1, 1),
  };
}
