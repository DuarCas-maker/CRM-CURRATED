import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export const diagnosticRoot =
  "docs/specs/pipeline-os/s02/release/permission-diagnostic/";
export const maxDiagnosticBytes = 2_097_152;
const hash = z.string().regex(/^[a-f0-9]{32}$/);
const hash256 = z.string().regex(/^[a-f0-9]{64}$/);
const nullableHash = hash.nullable();
const role = z
  .string()
  .regex(
    /^(PUBLIC|anon|authenticated|service_role|postgres|supabase_admin|authenticator|supabase_auth_admin|supabase_storage_admin|pg_database_owner|role_[a-f0-9]{32})$/,
  );
const identifier = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(128);
const key = z
  .string()
  .max(1500)
  .regex(/^[A-Za-z0-9_ .,:()\[\]>]+$/);
const privilege = z.enum([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "EXECUTE",
  "USAGE",
  "CREATE",
  "MAINTAIN",
]);
const acl = z
  .array(
    z.strictObject({
      grantee: role,
      grantor: role,
      privilege,
      grantable: z.boolean(),
    }),
  )
  .max(8192);
const relationAccess = z.strictObject({
  anon: z.array(privilege),
  authenticated: z.array(privilege),
  service_role: z.array(privilege),
});
const functionAccess = z.strictObject({
  anon: z.boolean(),
  authenticated: z.boolean(),
  service_role: z.boolean(),
});
const security = z.array(
  z.enum([
    "security_invoker=true",
    "security_invoker=false",
    "security_barrier=true",
    "security_barrier=false",
  ]),
);
const sectionSchemas = {
  roles: z.strictObject({
    key: role,
    inherit: z.boolean(),
    superuser: z.boolean(),
    bypass: z.boolean(),
  }),
  memberships: z.strictObject({
    key,
    member: role,
    role,
    grantor: role,
    admin: z.boolean(),
    member_effective: z.boolean(),
    usage_effective: z.boolean(),
  }),
  schemas: z.strictObject({
    key: z.enum(["public", "storage"]),
    owner: role,
    acl_is_null: z.boolean(),
    acl,
    access: z.strictObject({
      anon: z.strictObject({ usage: z.boolean(), create: z.boolean() }),
      authenticated: z.strictObject({
        usage: z.boolean(),
        create: z.boolean(),
      }),
      service_role: z.strictObject({ usage: z.boolean(), create: z.boolean() }),
    }),
  }),
  relations: z.strictObject({
    key,
    owner: role,
    kind: z.enum(["r", "p", "v", "m"]),
    rls: z.boolean(),
    force: z.boolean(),
    security,
    acl_is_null: z.boolean(),
    acl,
    access: relationAccess,
  }),
  columns: z.strictObject({
    key,
    not_null: z.boolean(),
    type: key,
    default_hash: nullableHash,
    acl,
    access: relationAccess.nullable(),
  }),
  functions: z.strictObject({
    key,
    owner: role,
    language: z.enum(["sql", "plpgsql", "c", "internal"]),
    kind: z.literal("f"),
    volatility: z.enum(["i", "s", "v"]),
    strict: z.boolean(),
    parallel: z.enum(["s", "r", "u"]),
    definer: z.boolean(),
    returns_set: z.boolean(),
    leakproof: z.boolean(),
    definition_hash: hash,
    definition_lf_hash: hash,
    source_hash: hash,
    source_lf_hash: hash,
    defaults_hash: nullableHash,
    config_hash: hash,
    result_hash: hash,
    search_path_kind: z.enum(["empty", "unset", "pg_catalog", "other"]),
    inspect_acl: z.boolean(),
    acl_is_null: z.boolean(),
    acl,
    access: functionAccess,
  }),
  defaults: z.strictObject({
    key,
    owner: role,
    schema: z.enum(["public", "storage", "GLOBAL"]),
    kind: z.enum(["r", "f", "S", "n"]),
    acl,
  }),
  policies: z.strictObject({
    key,
    command: z.enum(["*", "r", "a", "w", "d"]),
    permissive: z.boolean(),
    roles: z.array(role),
    using_hash: nullableHash,
    using_lf_hash: nullableHash,
    check_hash: nullableHash,
    check_lf_hash: nullableHash,
  }),
  views: z.strictObject({
    key,
    definition_hash: hash,
    definition_lf_hash: hash,
  }),
  constraints: z.strictObject({
    key,
    kind: z.enum(["c", "f", "p", "u", "t", "x"]),
    validated: z.boolean(),
    deferrable: z.boolean(),
    deferred: z.boolean(),
    definition_hash: hash,
    columns: z.array(identifier),
    target: key.nullable(),
    target_columns: z.array(identifier),
    update_action: z.string().max(1),
    delete_action: z.string().max(1),
    match: z.string().max(1),
  }),
  dependencies: z.strictObject({
    key,
    object: key,
    kind: z.enum(["function", "policy", "view"]),
    type: z.string().max(1),
    reference_hash: hash,
  }),
  storage_triggers: z.strictObject({
    key,
    enabled: z.enum(["O", "D", "R", "A"]),
    definition_hash: hash,
    function_hash: hash,
    extension_hash: nullableHash,
  }),
  storage_indexes: z.strictObject({ key, definition_hash: hash }),
};
const sectionsSchema = z.strictObject(
  Object.fromEntries(
    Object.entries(sectionSchemas).map(([name, schema]) => [
      name,
      z
        .array(schema)
        .max(
          name === "dependencies"
            ? 8192
            : name === "columns"
              ? 2048
              : name === "constraints"
                ? 1536
                : name === "defaults"
                  ? 1024
                  : name === "memberships"
                    ? 512
                    : 256,
        ),
    ]),
  ) as {
    [K in keyof typeof sectionSchemas]: z.ZodArray<(typeof sectionSchemas)[K]>;
  },
);
const countsSchema = z.strictObject({
  roles: z.number().int().nonnegative(),
  edges: z.number().int().nonnegative(),
  relations: z.number().int().nonnegative(),
  functions: z.number().int().nonnegative(),
  columns: z.number().int().nonnegative(),
  constraints: z.number().int().nonnegative(),
  acl: z.number().int().nonnegative(),
  defaults: z.number().int().nonnegative(),
  dependencies: z.number().int().nonnegative(),
  policies: z.number().int().nonnegative(),
  views: z.number().int().nonnegative(),
  storage_triggers: z.number().int().nonnegative(),
  storage_indexes: z.number().int().nonnegative(),
  unexpected_functions: z.number().int().nonnegative(),
});
export const envelopeSchema = z.strictObject({
  protocol: z.literal("PD-R1"),
  scope_sha256: hash256,
  context: z.strictObject({
    sql_role: role,
    read_only: z.literal("on"),
    server_version: z.string().regex(/^\d{6}$/),
    search_path: z.literal("pg_catalog"),
    superuser: z.boolean(),
    bypass: z.boolean(),
    migration_history_present: z.boolean(),
  }),
  completeness: z.strictObject({
    objects_ok: z.boolean(),
    limits_ok: z.boolean(),
    depth_exceeded: z.boolean(),
    counts: countsSchema,
  }),
  sections: sectionsSchema,
});
const scopeSchema = z.strictObject({
  version: z.literal("PD-R1"),
  inputSha256: hash256,
  limits: z.strictObject({
    roles: z.literal(256),
    edges: z.literal(512),
    depth: z.literal(8),
    relations: z.literal(128),
    functions: z.literal(256),
    columns: z.literal(2048),
    constraints: z.literal(1536),
    acl: z.literal(8192),
    defaults: z.literal(1024),
    dependencies: z.literal(8192),
    bytes: z.literal(2097152),
  }),
  relations: z
    .array(
      z.strictObject({
        key,
        schema: z.enum(["public", "storage"]),
        name: identifier,
        acl: z.boolean(),
      }),
    )
    .length(93),
  functions: z
    .array(
      z.strictObject({
        key,
        name: identifier,
        types: z.array(
          z.string().regex(/^(pg_catalog|public)\.[A-Za-z0-9_]+$/),
        ),
        acl: z.boolean(),
      }),
    )
    .length(206),
  policies: z
    .array(
      z.strictObject({
        key,
        schema: z.literal("public"),
        relation: identifier,
        name: identifier,
      }),
    )
    .length(8),
  views: z.array(key).length(3),
});

export type DiagnosticScope = z.infer<typeof scopeSchema>;
export type PermissionsDiagnostic = z.infer<typeof envelopeSchema>;
export type DiagnosticSection = keyof PermissionsDiagnostic["sections"];
export class DiagnosticInputError extends Error {
  constructor() {
    super("PD_INPUT_INVALID_OR_INCOMPLETE");
  }
}
function invalid(): never {
  throw new DiagnosticInputError();
}
export function parseScope(value: unknown): DiagnosticScope {
  const parsed = scopeSchema.safeParse(value);
  if (!parsed.success) return invalid();
  for (const rows of [
    parsed.data.relations,
    parsed.data.functions,
    parsed.data.policies,
  ])
    if (new Set(rows.map((r) => r.key)).size !== rows.length) invalid();
  return parsed.data;
}
export function scopeDigest(scope: DiagnosticScope): string {
  return createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}
export async function loadScope(): Promise<DiagnosticScope> {
  return parseScope(
    JSON.parse(await readFile(diagnosticRoot + "scope.json", "utf8")),
  );
}
export async function renderDiagnosticSql(
  scope: DiagnosticScope,
): Promise<string> {
  const valid = parseScope(scope);
  const template = await readFile(
    diagnosticRoot + "diagnostic.template.sql",
    "utf8",
  );
  if (
    template.split("__SCOPE_JSON__").length !== 2 ||
    template.split("__SCOPE_SHA256__").length !== 3
  )
    invalid();
  return template
    .replace("__SCOPE_JSON__", JSON.stringify(valid).replaceAll("'", "''"))
    .replaceAll("__SCOPE_SHA256__", scopeDigest(valid));
}
export function parseDiagnostic(
  value: unknown,
  scope: DiagnosticScope,
): PermissionsDiagnostic {
  try {
    if (Buffer.byteLength(JSON.stringify(value)) > maxDiagnosticBytes)
      invalid();
  } catch {
    return invalid();
  }
  let normalized = value;
  if (Array.isArray(value)) {
    if (
      value.length !== 1 ||
      value[0] === null ||
      typeof value[0] !== "object" ||
      Object.keys(value[0]).join() !== "pipeline_os_abc_permissions_diagnostic"
    )
      invalid();
    normalized = value[0].pipeline_os_abc_permissions_diagnostic;
  }
  const parsed = envelopeSchema.safeParse(normalized);
  if (!parsed.success) return invalid();
  const d = parsed.data,
    c = d.completeness;
  if (
    d.scope_sha256 !== scopeDigest(scope) ||
    !c.objects_ok ||
    !c.limits_ok ||
    c.depth_exceeded ||
    c.counts.unexpected_functions !== 0 ||
    !d.context.superuser ||
    !d.context.bypass
  )
    invalid();
  const expected = {
    functions: scope.functions.map((x) => x.key),
    relations: scope.relations.filter((x) => x.acl).map((x) => x.key),
    policies: scope.policies.map((x) => x.key),
    views: scope.views,
    schemas: ["public", "storage"],
  };
  for (const [name, rows] of Object.entries(d.sections)) {
    if (new Set(rows.map((r) => r.key)).size !== rows.length) invalid();
    const wanted = expected[name as keyof typeof expected];
    if (
      wanted &&
      (rows.length !== wanted.length ||
        rows.some((r) => !wanted.includes(r.key)))
    )
      invalid();
  }
  const counts = c.counts;
  if (
    counts.relations !== scope.relations.length ||
    counts.functions !== scope.functions.length ||
    counts.policies !== scope.policies.length ||
    counts.views !== scope.views.length ||
    counts.roles !== d.sections.roles.length ||
    counts.edges !== d.sections.memberships.length ||
    counts.columns !== d.sections.columns.length ||
    counts.constraints !== d.sections.constraints.length ||
    counts.defaults !== d.sections.defaults.length ||
    counts.dependencies !== d.sections.dependencies.length ||
    counts.storage_triggers !== d.sections.storage_triggers.length ||
    counts.storage_indexes !== d.sections.storage_indexes.length
  )
    invalid();
  if (
    counts.roles > 256 ||
    counts.edges > 512 ||
    counts.columns > 2048 ||
    counts.constraints > 1536 ||
    counts.acl > 8192 ||
    counts.defaults > 1024 ||
    counts.dependencies > 8192 ||
    counts.storage_triggers > 16 ||
    counts.storage_indexes > 32
  )
    invalid();
  if (
    !["anon", "authenticated", "service_role"].every((k) =>
      d.sections.roles.some((r) => r.key === k),
    )
  )
    invalid();
  if (
    d.sections.columns.some(
      (r) => !scope.relations.some((t) => r.key.startsWith(t.key + ".")),
    )
  )
    invalid();
  if (
    d.sections.functions.some(
      (r) =>
        r.inspect_acl !== scope.functions.find((f) => f.key === r.key)?.acl ||
        (!r.inspect_acl && r.acl.length),
    )
  )
    invalid();
  if (
    counts.acl !==
    [...d.sections.relations, ...d.sections.functions].reduce(
      (n, r) => n + r.acl.length,
      0,
    )
  )
    invalid();
  if (
    !scope.relations.every((r) =>
      d.sections.columns.some((c) => c.key.startsWith(r.key + ".")),
    )
  )
    invalid();
  return d;
}
export function parseDiagnosticText(
  text: string,
  scope: DiagnosticScope,
): PermissionsDiagnostic {
  if (Buffer.byteLength(text) > maxDiagnosticBytes) invalid();
  try {
    return parseDiagnostic(JSON.parse(text.replace(/^\uFEFF/, "")), scope);
  } catch {
    return invalid();
  }
}
export async function loadDiagnosticFile(
  file: string,
  scope: DiagnosticScope,
): Promise<PermissionsDiagnostic> {
  if (
    ![".json", ".txt"].includes(extname(file).toLowerCase()) ||
    basename(file).startsWith(".env")
  )
    invalid();
  if ((await stat(file)).size > maxDiagnosticBytes) invalid();
  return parseDiagnosticText(await readFile(file, "utf8"), scope);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function compareDiagnostics(
  reference: PermissionsDiagnostic,
  observed: PermissionsDiagnostic,
  scope: DiagnosticScope,
) {
  const a = parseDiagnostic(reference, scope),
    b = parseDiagnostic(observed, scope);
  const findings: {
    section: DiagnosticSection;
    key: string;
    fields: string[];
    classification:
      | "explained_metadata"
      | "confirmed_permission_drift"
      | "unresolved_definition"
      | "platform_pending"
      | "incomplete";
  }[] = [];
  for (const section of Object.keys(sectionSchemas) as DiagnosticSection[]) {
    const before = new Map(
      a.sections[section].map((r) => [r.key, r as Record<string, unknown>]),
    );
    const after = new Map(
      b.sections[section].map((r) => [r.key, r as Record<string, unknown>]),
    );
    for (const k of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const x = before.get(k),
        y = after.get(k);
      const fields =
        !x || !y
          ? [!x ? "added" : "missing"]
          : [...new Set([...Object.keys(x), ...Object.keys(y)])]
              .filter((f) => f !== "key" && canonical(x[f]) !== canonical(y[f]))
              .sort();
      if (!fields.length) continue;
      let classification: (typeof findings)[number]["classification"] =
        "unresolved_definition";
      if (!y && !section.startsWith("storage_") && !k.startsWith("storage."))
        classification = "incomplete";
      else if (
        ["roles", "memberships", "schemas", "defaults"].includes(section) ||
        fields.some((f) =>
          [
            "access",
            "acl",
            "rls",
            "force",
            "security",
            "definer",
            "search_path_kind",
            "owner",
          ].includes(f),
        )
      )
        classification = "confirmed_permission_drift";
      else if (section.startsWith("storage_") || k.startsWith("storage."))
        classification = "platform_pending";
      else if (fields.every((f) => f === "acl_is_null"))
        classification = "explained_metadata";
      else if (
        section === "functions" &&
        x &&
        y &&
        fields.every((f) => f === "definition_hash") &&
        x.source_hash === y.source_hash &&
        x.definition_lf_hash === y.definition_lf_hash
      )
        classification = "explained_metadata";
      findings.push({ section, key: k, fields, classification });
    }
  }
  return {
    protocol: "PD-R1" as const,
    referenceVersion: a.context.server_version,
    observedVersion: b.context.server_version,
    comparedObjects: Object.values(b.sections).reduce(
      (n, rows) => n + rows.length,
      0,
    ),
    findings,
    status: findings.some((f) => f.classification !== "explained_metadata")
      ? ("findings_open" as const)
      : ("no_unexplained_difference_in_scope" as const),
    publicationApproved: false as const,
    targetIdentityAttested: false as const,
    remoteChanges: 0,
    providerRequests: 0,
    instantlyConsumed: 43,
  };
}
export async function diagnosticCli(args: string[]): Promise<string> {
  const scope = await loadScope();
  if (args.length === 1 && args[0] === "--render")
    return renderDiagnosticSql(scope);
  if (args.length !== 3 || args[0] !== "--compare") invalid();
  return (
    JSON.stringify(
      compareDiagnostics(
        await loadDiagnosticFile(args[1], scope),
        await loadDiagnosticFile(args[2], scope),
        scope,
      ),
      null,
      2,
    ) + "\n"
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.stdout.write(await diagnosticCli(process.argv.slice(2)));
  } catch {
    process.stderr.write("PD_INPUT_INVALID_OR_INCOMPLETE\n");
    process.exitCode = 1;
  }
}
