import { createHash } from "node:crypto";

export const maxViewBytes = 16_384;
export const maxViewTokens = 2_048;
// Same anchored grammar is embedded in SQL. Strings containing backslashes and
// prefixed/dollar literals are deliberately unsupported, rather than rewritten.
export const viewTokenPattern = String.raw`([ \t\r\n\f]+|'(?:[^'\\]|'')*'|"(?:[^"]|"")*"|[A-Za-z_][A-Za-z_0-9$]*|[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[+*/<>=~!@#%^&|?\x60-]+|::|[(),.;\[\]])`;
const tokenRe = new RegExp("^" + viewTokenPattern);
const whitespace = /^[ \t\r\n\f]+$/;
const unsupportedPrefix = /^(?:[eEbBxXnN]'|[uU]&['"]|--|\/\*)/;
export const md5 = (value: string) =>
  createHash("md5").update(value).digest("hex");
export type ViewFingerprint = {
  status: "complete" | "incomplete";
  count: number;
  hash: string | null;
  quotedHash: string | null;
};

export function fingerprintView(sql: string): ViewFingerprint {
  let rest = sql,
    stream = "",
    quoted = "",
    count = 0;
  const incomplete = (): ViewFingerprint => ({
    status: "incomplete",
    count,
    hash: null,
    quotedHash: null,
  });
  if (Buffer.byteLength(sql) > maxViewBytes) return incomplete();
  while (rest.length) {
    if (unsupportedPrefix.test(rest) || count >= maxViewTokens)
      return incomplete();
    const token = rest.match(tokenRe)?.[0];
    if (!token) return incomplete();
    rest = rest.slice(token.length);
    if (whitespace.test(token)) continue;
    const kind = token.startsWith("'")
      ? "s"
      : token.startsWith('"')
        ? "q"
        : /^[A-Za-z_]/.test(token)
          ? "w"
          : /^[0-9]/.test(token)
            ? "n"
            : "p";
    const value = kind === "w" ? token.toLowerCase() : token;
    const encoded = kind + Buffer.byteLength(value) + ":" + value + ";";
    stream += encoded;
    if (kind === "q" || kind === "s") quoted += encoded;
    count++;
  }
  return {
    status: "complete",
    count,
    hash: md5(stream),
    quotedHash: md5(quoted),
  };
}

/** CTEs for a fixed `definitions(key,definition)` input. No UDF or execution. */
export function fingerprintCtes(): string {
  const literal = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  return `
lex(key,rest,stream,quoted,count,steps,ok) as (
 select key,definition,''::text,''::text,0,0,octet_length(definition)<=${maxViewBytes} from definitions
 union all
 select l.key,case when t.token is null then '' else substr(l.rest,length(t.token)+1) end,
 l.stream||case when k.kind in ('s','q','w','n','p') then k.kind||octet_length(v.value)::text||':'||v.value||';' else '' end,
 l.quoted||case when k.kind in ('s','q') then k.kind||octet_length(v.value)::text||':'||v.value||';' else '' end,
 l.count+case when k.kind='z' then 0 else 1 end,l.steps+1,
 t.token is not null and l.count<${maxViewTokens} and not(l.rest ~ ${literal("^(?:[eEbBxXnN]'|[uU]&['\"]|--|/\\*)")})
 from lex l
 cross join lateral (select substring(l.rest from ${literal("^" + viewTokenPattern)}) token) t
 cross join lateral (select case when t.token ~ ${literal("^[ \\t\\r\\n\\f]+$")} then 'z'
 when left(t.token,1)=${literal("'")} then 's' when left(t.token,1)='"' then 'q'
 when t.token ~ '^[A-Za-z_]' then 'w' when t.token ~ '^[0-9]' then 'n' else 'p' end kind) k
 cross join lateral (select case when k.kind='w' then translate(t.token,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') else t.token end value) v
 where l.ok and l.rest<>'' and l.steps<${maxViewTokens * 2 + 1}
),
fingerprints as (
 select distinct on(key) key,jsonb_build_object('status',case when ok and rest='' then 'complete' else 'incomplete' end,
 'count',count,'hash',case when ok and rest='' then md5(stream) else null end,
 'quotedHash',case when ok and rest='' then md5(quoted) else null end) fingerprint
 from lex order by key,steps desc
)`;
}
