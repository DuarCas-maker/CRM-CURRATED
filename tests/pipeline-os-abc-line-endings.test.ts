import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { format } from "prettier";
import { restoreCatalogPrior } from "../scripts/pipeline-os/abc-catalog-variants";
import {
  abcFinalFixture,
  abcFinalRoot as root,
  abcSnapshot,
} from "./fixtures/pipeline-os-abc-final";
import {
  derivePostVariants,
  multilineQuotedTokens,
  previousSourceSetSql,
  revisedSourceSetSql,
  previousUntouchedSql,
  revisedUntouchedSql,
  reviseSourceArtifacts,
} from "../scripts/pipeline-os/abc-source-variants";
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const inputs = Promise.all([
  readFile(
    root + "049_integrate_mail_identity_brands_and_bindings.sql",
    "utf8",
  ),
  readFile(root + "postflight.sql", "utf8"),
  readFile(root + "contract.json", "utf8"),
]).then(async ([migration, postflight, contract]) => {
  const prior = await restoreCatalogPrior({ migration, postflight, contract });
  return [prior.migration, prior.postflight, prior.contract];
});
const crlf = (sql: string) =>
  sql.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
const execute = async (
  f: Awaited<ReturnType<typeof abcFinalFixture>>,
  sql: string,
) => {
  await f.admin();
  try {
    return (await f.db.exec(sql)).flatMap((r) => r.rows);
  } catch (e) {
    await f.db.exec("rollback");
    throw e;
  }
};

test("EOL-AC01/02: derive only exact whole-body LF/CRLF pairs without rewriting quoted content", () => {
  const source = "begin\n return 'safe';\nend";
  const row = {
    key: "test.fn()",
    source,
    expectedHash: md5(source),
    crlfHash: md5(crlf(source)),
  };
  assert.deepEqual(derivePostVariants([row]), {
    "test.fn()": [md5(source), md5(crlf(source))],
  });
  for (const wrong of [
    { ...row, source: source + " " },
    { ...row, crlfHash: "0".repeat(32) },
    {
      ...row,
      source: "begin\r return 'safe';end",
      expectedHash: md5("begin\r return 'safe';end"),
    },
  ])
    assert.throws(() => derivePostVariants([wrong]));
  const quoted = "select 'a\nb'";
  assert.throws(
    () =>
      derivePostVariants([
        {
          ...row,
          source: quoted,
          expectedHash: md5(quoted),
          crlfHash: md5(crlf(quoted)),
        },
      ]),
    /Multiline quoted/,
  );
});
test("EOL-AC02: lexer handles comments, escapes, dollar strings, identifiers and refuses incomplete tokens", () => {
  assert.equal(
    multilineQuotedTokens(
      "-- quoted '\n/* nested /* x */ x */\nselect 'safe';",
    ),
    0,
  );
  for (const sql of [
    "select 'a\nb'",
    'select "a\nb"',
    "select $tag$a\nb$tag$",
    "select E'it\\'s\nx'",
  ])
    assert.equal(multilineQuotedTokens(sql), 1);
  for (const sql of ["select 'unclosed", "/* unclosed", "select $q$unclosed"])
    assert.throws(() => multilineQuotedTokens(sql));
});
test("EOL-AC03/04: removing only the new map, matcher and SHA reconstructs the exact prior artifacts", async () => {
  const [sql, post, text] = await inputs,
    newContract = JSON.parse(text);
  assert.equal(Object.keys(newContract.postSourceVariants).length, 117);
  const oldContract = { ...newContract };
  delete oldContract.postSourceVariants;
  delete oldContract.protectedSourceVariants;
  const oldText = await format(JSON.stringify(oldContract), { parser: "json" });
  assert.equal(
    sha(oldText),
    "8fafee3c08c3aea1941b91058fcc9594560d280ede7b66724583b5167f932321",
  );
  const quote = (d: unknown) =>
    "'" + JSON.stringify(d).replaceAll("'", "''") + "'::jsonb";
  const reverse = (s: string) =>
    s
      .replaceAll(quote(newContract), quote(oldContract))
      .replaceAll(sha(text), sha(oldText))
      .replaceAll(revisedSourceSetSql, previousSourceSetSql)
      .replaceAll(revisedUntouchedSql, previousUntouchedSql);
  assert.equal(
    sha(reverse(sql)),
    "e4626cb612868f4cd13ebce98ca3a6b5fea0e51f7d73b05f0e4935dd3be0b604",
  );
  assert.equal(
    sha(reverse(post)),
    "bae5b6653aee9eeb928e1ee1079adf52a7492bd9065595e40c67de5f74088e10",
  );
  assert.deepEqual(
    await reviseSourceArtifacts(
      { migration: reverse(sql), postflight: reverse(post), contract: oldText },
      newContract.postSourceVariants,
      newContract.protectedSourceVariants,
    ),
    { migration: sql, postflight: post, contract: text },
  );
  for (const [key, values] of Object.entries(
    newContract.postSourceVariants,
  ) as [string, string[]][]) {
    assert.equal(values[0], newContract.post.functions[key].sourceHash);
    assert.equal(new Set(values).size, 2);
  }
});

for (const style of ["LF", "CRLF"] as const)
  test(`EOL-AC01/03/05: exact ${style} application commits and both postflight serializations agree`, async () => {
    const [sql, post, text] = await inputs,
      f = await abcFinalFixture();
    try {
      const app = (await execute(f, style === "LF" ? sql : crlf(sql))).find(
        (r: any) => r.pipeline_os_abc_application,
      )?.pipeline_os_abc_application as any;
      assert(app.targetsOk && app.preservationMatches);
      assert.equal(app.contractSha256, sha(text));
      for (const candidate of [post, crlf(post)]) {
        const observed = (await execute(f, candidate)).find(
          (r: any) => r.pipeline_os_abc_postflight,
        )?.pipeline_os_abc_postflight as any;
        assert(observed.rolesOk && observed.targetsOk);
        assert.equal(observed.context.readOnly, "on");
        assert.equal(observed.protectedFingerprint, app.protectedAfter);
      }
      if (style === "CRLF") {
        await f.db.exec("set search_path=pg_catalog,pg_temp");
        const data = JSON.parse(text);
        const sources = (
          await f.db.query<{ key: string; source: string }>(
            `select format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)) key,p.prosrc source from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','brand_b1','brand_b2','s01_i02','composio_c1')`,
          )
        ).rows;
        for (const [key, variants] of Object.entries({
          ...data.postSourceVariants,
          ...data.protectedSourceVariants,
        }) as [string, string[]][]) {
          const source = sources.find((r) => r.key === key)!.source;
          assert.equal(multilineQuotedTokens(source), 0);
          assert.equal(md5(source), variants[1]);
          assert.equal(md5(source.replaceAll("\r\n", "\n")), variants[0]);
        }
        // Even an admitted body remains subject to every other metadata/ACL field.
        await f.db.exec(
          "grant execute on function composio_c1.mask(text) to anon",
        );
        const denied = (await execute(f, post)).find(
          (r: any) => r.pipeline_os_abc_postflight,
        )?.pipeline_os_abc_postflight as any;
        assert.equal(denied.targetsOk, false);
        await f.db.exec(
          "revoke execute on function composio_c1.mask(text) from anon;alter function public.campaign_contact_summary(uuid) set search_path=public",
        );
        const protectedDrift = (await execute(f, post)).find(
          (r: any) => r.pipeline_os_abc_postflight,
        )?.pipeline_os_abc_postflight as any;
        assert.equal(protectedDrift.targetsOk, true);
        assert.notEqual(
          protectedDrift.protectedFingerprint,
          app.protectedAfter,
        );
      }
    } finally {
      await f.db.close();
    }
  });

test("EOL-AC05: old matcher reproduces the CRLF failure; code, literal, mixed-body and config drift still roll back", async () => {
  const [sql] = await inputs,
    f = await abcFinalFixture();
  try {
    const before = await abcSnapshot(f);
    const candidates = [
      crlf(sql.replaceAll(revisedSourceSetSql, previousSourceSetSql)),
      sql.replace(
        "char_length(value) not between 1 and 120",
        "char_length(value) not between 1 and 119",
      ),
      crlf(sql.replace("'…'||right(value,4)", "'X'||right(value,4)")),
      sql.replace(
        "begin\n if value is null then return null;end if;",
        "begin\r\n if value is null then return null;end if;",
      ),
      sql.replace(
        "do $af_check$",
        "alter function composio_c1.mask(text) set search_path=public;\ndo $af_check$",
      ),
    ];
    for (const candidate of candidates) {
      assert.notEqual(candidate, sql);
      await assert.rejects(
        execute(f, candidate),
        /ABC_FINAL_CONTRACT_MISMATCH/,
      );
      assert.deepEqual(await abcSnapshot(f), before);
    }
    const protectedMutation = sql.replace(
      "do $af_check$",
      "do $qa$declare definition text;begin select pg_get_functiondef('public.campaign_contact_summary(uuid)'::regprocedure) into definition;execute replace(definition,chr(10),chr(10)||' ');end$qa$;\ndo $af_check$",
    );
    await assert.rejects(
      execute(f, protectedMutation),
      /ABC_PROTECTED_METADATA_CHANGED/,
    );
    assert.deepEqual(await abcSnapshot(f), before);
  } finally {
    await f.db.close();
  }
});
