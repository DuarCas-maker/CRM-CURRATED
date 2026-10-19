"use client";
import "./company-application.css";
import { useEffect, useState } from "react";
import type { Locale, Workspace, Opportunity } from "@/lib/domain";
import {
  emptyCompanyApplication,
  SAMPLE_APPLICATION_DECLARATION,
  companyOwnerSchema,
  companyApplicationSchema,
  entityTypes,
  usStates,
  formatTaxId,
  adultBirthDate,
  requiredBusinessFields,
  requiredOwnerFields,
  secondOwnerAnswer,
  bindApplicationAdvisor,
  type CompanyApplication,
  type ApplicationSignature,
} from "@/lib/company-application";
import { SignaturePad } from "./signature-pad";
import { ApplicationExtraction } from "./application-extraction";
import { CompanyApplicationActions } from "./company-application-actions";
import {
  applicationFieldValue,
  mergeApplicationExtraction,
  normalizeExtractionValue,
  setApplicationField,
  type ExtractionField,
  type ExtractionNotice,
} from "@/lib/application-extraction";
import { useUnsavedChanges } from "./unsaved-changes";
import { Modal, t } from "./ui";
const fields: [
  keyof Omit<CompanyApplication, "owners" | "second_owner">,
  string,
  string,
  string?,
][] = [
  ["legal_name", "Nombre legal de la empresa", "Legal Company Name"],
  ["entity_type", "Tipo de entidad", "Entity Type"],
  ["ein", "EIN / Identificación fiscal", "Federal Tax ID / EIN"],
  ["incorporation_state", "Estado de constitución", "State of Incorporation"],
  [
    "inception_date",
    "Fecha de inicio del negocio",
    "Business Inception Date",
    "date",
  ],
  ["business_address", "Dirección de la empresa", "Business Street Address"],
  ["business_city", "Ciudad", "City"],
  ["business_state", "Estado", "State"],
  ["business_zip", "Código ZIP", "ZIP Code"],
  ["commercial_name", "Nombre comercial / asesor", "Commercial name"],
  [
    "commercial_email",
    "Correo comercial / asesor",
    "Commercial Email",
    "email",
  ],
];
const ownerFields: [string, string, string, string?][] = [
  ["name", "Nombre del propietario", "Owner Name"],
  ["email", "Correo", "Email", "email"],
  ["ssn", "SSN", "SSN", "text"],
  ["date_of_birth", "Fecha de nacimiento", "Date of Birth", "date"],
  ["phone", "Celular", "Cell Phone", "tel"],
  ["address", "Dirección", "Owner Street Address"],
  ["city", "Ciudad", "City"],
  ["state", "Estado", "State"],
  ["zip", "Código ZIP", "ZIP Code"],
  ["ownership", "Porcentaje de propiedad", "Ownership Percentage", "number"],
];
export function CompanyApplicationForm({
  opportunity,
  workspace,
  locale,
  close,
  refresh,
}: {
  opportunity: Opportunity;
  workspace: Workspace;
  locale: Locale;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [data, setData] = useState(() => ({
      ...emptyCompanyApplication(opportunity.company),
      commercial_name:
        workspace.profiles.find((p) => p.id === opportunity.seller_id)?.name ||
        "",
      commercial_email:
        workspace.profiles.find((p) => p.id === opportunity.seller_id)?.email ||
        "",
      identifier: opportunity.seller_id || "",
    })),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(!workspace.demo),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [signature, setSignature] = useState(""),
    [wantSign, setWantSign] = useState(false),
    [authorized, setAuthorized] = useState(false),
    [previousSignature, setPreviousSignature] =
      useState<ApplicationSignature | null>(null),
    [declaration, setDeclaration] = useState<string | null>(
      workspace.demo ? SAMPLE_APPLICATION_DECLARATION : null,
    );
  const [declarationHash, setDeclarationHash] = useState<string | null>(null);
  const [generatedRevision, setGeneratedRevision] = useState<number | null>(
      null,
    ),
    [pdfNotification, setPdfNotification] = useState(false);
  const [advisors, setAdvisors] = useState(
    workspace.profiles.filter((p) => p.active !== false),
  );
  const [extractionPending, setExtractionPending] = useState(false);
  const [notices, setNotices] = useState<ExtractionNotice[]>([]),
    [sources, setSources] = useState<string[]>([]);
  const changes = useUnsavedChanges(
    { data, signature, wantSign, authorized },
    busy || loading,
  );
  const dirty = changes.dirty;
  useEffect(() => {
    if (!pdfNotification) return;
    const timer = window.setTimeout(() => setPdfNotification(false), 6000);
    return () => window.clearTimeout(timer);
  }, [pdfNotification]);
  useEffect(() => {
    if (workspace.demo) return;
    const controller = new AbortController();
    fetch(
      `/api/company-application?${new URLSearchParams({ opportunity: opportunity.id })}`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        if (controller.signal.aborted) return;
        if (b.advisors) setAdvisors(b.advisors);
        if (b.record) {
          const loaded = companyApplicationSchema.parse(b.record.data);
          changes.markSaved({
            data: structuredClone(loaded),
            signature: "",
            wantSign: false,
            authorized: false,
          });
          // Preserve signed snapshots; only fill missing advisor details in drafts.
          if (!b.record.signature && b.defaults) {
            for (const key of [
              "commercial_name",
              "commercial_email",
              "identifier",
            ] as const)
              if (!loaded[key] && b.defaults[key]) {
                loaded[key] = b.defaults[key];
              }
          }
          setData(loaded);
          setPreviousSignature(b.record.signature);
        }
        if (!b.record && b.defaults) {
          const defaults = companyApplicationSchema.parse(b.defaults);
          setData(defaults);
          changes.markSaved({
            data: defaults,
            signature: "",
            wantSign: false,
            authorized: false,
          });
        }
        setRevision(b.revision);
        setGeneratedRevision(b.generated_revision);
        setDeclaration(b.declaration);
        setDeclarationHash(b.declaration_hash);
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [opportunity.id, workspace.demo]);
  function changed(next: CompanyApplication) {
    setData(next);
    setSignature("");
    setAuthorized(false);
    setPreviousSignature(null);
    setMessage("");
    setPdfNotification(false);
  }
  function fieldNotices(field: ExtractionField) {
    return notices
      .filter((n) => n.field === field)
      .map((notice, index) => {
        const candidate = normalizeExtractionValue(field, notice.value);
        const canApply =
          notice.reason === "review" &&
          candidate !== null &&
          applicationFieldValue(data, field) === "" &&
          (!field.startsWith("owners.1.") || data.owners.length > 1);
        return (
          <div
            className="application-field-notice"
            role="status"
            key={`${field}-${index}`}
          >
            <strong>
              {notice.reason === "missing"
                ? t(locale, "No encontrado", "Not found")
                : notice.reason === "conflict"
                  ? t(
                      locale,
                      "Conflicto: requiere revisión",
                      "Conflicting information: needs review",
                    )
                  : notice.reason === "different"
                    ? t(
                        locale,
                        "Diferencia detectada; se conservó el dato existente",
                        "Difference found; existing value preserved",
                      )
                    : t(locale, "Requiere revisión", "Needs review")}
            </strong>
            {notice.value && <div>{notice.value}</div>}
            {notice.evidence.map((e, i) => (
              <small key={i}>
                {e.source === "user"
                  ? t(locale, "Dato proporcionado", "User-provided fact")
                  : sources[Number(e.source.slice(-1)) - 1]}
                {e.page ? ` · ${t(locale, "pág.", "p.")} ${e.page}` : ""}:{" "}
                {e.quote}
              </small>
            ))}
            {canApply && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  const next = setApplicationField(data, field, candidate);
                  if (
                    field.endsWith(".ownership") &&
                    next.owners.reduce(
                      (sum, o) => sum + Number(o.ownership),
                      0,
                    ) > 100
                  ) {
                    setError(
                      t(
                        locale,
                        "La propiedad no puede superar el 100%.",
                        "Ownership cannot exceed 100%.",
                      ),
                    );
                    return;
                  }
                  changed(next);
                  setNotices(notices.filter((n) => n !== notice));
                }}
              >
                {t(locale, "Confirmar e incorporar", "Confirm and fill")}
              </button>
            )}
          </div>
        );
      });
  }
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    setPdfNotification(false);
    try {
      if (workspace.demo) {
        setRevision((v) => v + 1);
        changes.markSaved();
        setMessage(
          t(
            locale,
            "Borrador guardado únicamente en esta demostración.",
            "Draft saved only in this demonstration.",
          ),
        );
        return;
      }
      const r = await fetch("/api/company-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunity_id: opportunity.id,
          revision,
          action: "save",
          data,
          signature: wantSign ? { image: signature, authorized } : null,
          declaration_hash: declarationHash,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      if (b.revision !== revision + 1)
        throw new Error(
          t(
            locale,
            "No se pudo confirmar el guardado.",
            "Could not confirm the save.",
          ),
        );
      setRevision(b.revision);
      changes.markSaved({
        data,
        signature: "",
        wantSign: false,
        authorized: false,
      });
      setMessage(
        t(
          locale,
          "Aplicación guardada. Ya puedes generar el PDF.",
          "Application saved. You can now generate the PDF.",
        ),
      );
      setWantSign(false);
      setSignature("");
      setAuthorized(false);
      if (wantSign)
        setPreviousSignature({
          image: "",
          actor_id: workspace.profile.id,
          name: workspace.profile.name,
          signed_at: new Date().toISOString(),
          capacity: "authorized_representative",
        });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    setBusy(true);
    setError("");
    setMessage("");
    setPdfNotification(false);
    try {
      if (workspace.demo) {
        setMessage(
          t(
            locale,
            "La generación y el guardado en Supabase requieren una oportunidad real.",
            "Generation and saving to Supabase require a real opportunity.",
          ),
        );
        return;
      }
      const r = await fetch("/api/company-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunity_id: opportunity.id,
          revision,
          action: "generate",
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      if (b.revision !== revision || !b.document_id)
        throw new Error(
          t(
            locale,
            "No se pudo confirmar la incorporación del PDF.",
            "Could not confirm the PDF attachment.",
          ),
        );
      await refresh();
      setGeneratedRevision(b.revision);
      setPdfNotification(true);
      setMessage(
        t(
          locale,
          "PDF incorporado a Documentos como recibido. Revisa y aprueba su contenido antes de enviarlo.",
          "PDF added to Documents as received. Review and approve it before sending.",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      locale={locale}
      wide
      title={t(locale, "Aplicación de la empresa", "Company application")}
      dirty={dirty || extractionPending}
      busy={busy || loading}
      close={close}
    >
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {pdfNotification && (
        <div className="toast" role="status">
          {t(
            locale,
            "PDF generado e incorporado correctamente.",
            "PDF generated and attached successfully.",
          )}
        </div>
      )}
      <p className="muted">
        {t(
          locale,
          "Los datos se comparten entre las oportunidades de esta empresa. Cada PDF incorporado conserva su propia versión y revisión. Cambiar los datos requiere una nueva firma.",
          "Data is shared across this company’s opportunities. Each attached PDF retains its own version and review. Changing data requires a new signature.",
        )}
      </p>
      {loading ? (
        <p role="status">
          {t(locale, "Cargando aplicación…", "Loading application…")}
        </p>
      ) : (
        <>
          <ApplicationExtraction
            documents={workspace.documents.filter(
              (d) => d.opportunity_id === opportunity.id,
            )}
            opportunityId={opportunity.id}
            locale={locale}
            busy={busy}
            setBusy={setBusy}
            onPending={setExtractionPending}
            onResult={(items, names) => {
              const result = mergeApplicationExtraction(data, items);
              changed(result.data);
              setNotices(result.notices);
              setSources(names);
              setMessage(
                t(
                  locale,
                  "Extracción completada. Revisa los campos y las sugerencias antes de guardar.",
                  "Extraction completed. Review the fields and suggestions before saving.",
                ),
              );
            }}
          />
          <p className="muted">
            {t(
              locale,
              "Los campos marcados con * son obligatorios para generar el PDF; puedes guardar un borrador incompleto.",
              "Fields marked * are required to generate the PDF; you can save an incomplete draft.",
            )}
          </p>
          <div className="company-application-fields">
            {fields.map(([key, es, en, type]) => (
              <div key={key}>
                <label className="field">
                  <span>
                    {t(locale, es, en)}
                    {requiredBusinessFields.some((k) => k === key) && (
                      <span className="application-required" aria-hidden="true">
                        {" "}
                        *
                      </span>
                    )}
                  </span>
                  {key === "commercial_email" ? (
                    <select
                      disabled={busy}
                      value={data.commercial_email}
                      onChange={(e) =>
                        changed(
                          bindApplicationAdvisor(
                            { ...data, commercial_email: e.target.value },
                            advisors,
                          ),
                        )
                      }
                    >
                      <option value="">
                        {t(locale, "Seleccionar comercial…", "Select advisor…")}
                      </option>
                      {advisors.map((a) => (
                        <option key={a.id} value={a.email}>
                          {a.email} · {a.name}
                        </option>
                      ))}
                      {data.commercial_email &&
                        !advisors.some(
                          (a) => a.email === data.commercial_email,
                        ) && (
                          <option value={data.commercial_email}>
                            {data.commercial_email} ·{" "}
                            {t(
                              locale,
                              "selecciona un usuario activo",
                              "select an active user",
                            )}
                          </option>
                        )}
                    </select>
                  ) : key === "entity_type" ||
                    key === "incorporation_state" ||
                    key === "business_state" ? (
                    <select
                      aria-required={requiredBusinessFields.some(
                        (k) => k === key,
                      )}
                      value={data[key]}
                      disabled={busy}
                      onChange={(e) =>
                        changed({ ...data, [key]: e.target.value })
                      }
                    >
                      <option value="">
                        {t(locale, "Seleccionar…", "Select…")}
                      </option>
                      {key === "entity_type"
                        ? entityTypes.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))
                        : usStates.map(([code, name]) => (
                            <option key={code} value={code}>
                              {name} ({code})
                            </option>
                          ))}
                      {data[key] &&
                        !(key === "entity_type"
                          ? entityTypes.some((value) => value === data[key])
                          : usStates.some(([code]) => code === data[key])) && (
                          <option value={data[key]}>
                            {data[key]} ·{" "}
                            {t(
                              locale,
                              "valor anterior: selecciona una opción",
                              "previous value: select an option",
                            )}
                          </option>
                        )}
                    </select>
                  ) : (
                    <input
                      aria-required={requiredBusinessFields.some(
                        (k) => k === key,
                      )}
                      readOnly={key === "commercial_name"}
                      type={type || "text"}
                      value={data[key]}
                      maxLength={key === "ein" ? 10 : 250}
                      inputMode={key === "ein" ? "numeric" : undefined}
                      placeholder={key === "ein" ? "12-3456789" : undefined}
                      disabled={busy}
                      autoComplete="off"
                      onChange={(e) =>
                        changed({
                          ...data,
                          [key]:
                            key === "ein"
                              ? formatTaxId(e.target.value, "ein")
                              : e.target.value,
                        })
                      }
                    />
                  )}
                </label>
                {key !== "commercial_name" &&
                  key !== "commercial_email" &&
                  key !== "identifier" &&
                  fieldNotices(key as ExtractionField)}
              </div>
            ))}
          </div>
          {data.owners.map((owner, i) => (
            <fieldset key={i} disabled={busy}>
              <legend>
                {i
                  ? t(locale, "Segundo propietario", "Second owner")
                  : t(locale, "Propietario", "Owner")}
              </legend>
              <div className="company-application-fields">
                {ownerFields.map(([key, es, en, type]) => (
                  <div key={key}>
                    <label className="field">
                      <span>
                        {t(locale, es, en)}
                        {requiredOwnerFields.some((k) => k === key) && (
                          <span
                            className="application-required"
                            aria-hidden="true"
                          >
                            {" "}
                            *
                          </span>
                        )}
                      </span>
                      {key === "state" ? (
                        <select
                          value={owner.state}
                          onChange={(e) =>
                            changed({
                              ...data,
                              owners: data.owners.map((o, j) =>
                                j === i ? { ...o, state: e.target.value } : o,
                              ),
                            })
                          }
                        >
                          <option value="">
                            {t(locale, "Seleccionar…", "Select…")}
                          </option>
                          {usStates.map(([code, name]) => (
                            <option key={code} value={code}>
                              {name} ({code})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-required={requiredOwnerFields.some(
                            (k) => k === key,
                          )}
                          type={type || "text"}
                          min={type === "number" ? 0 : undefined}
                          max={
                            type === "number"
                              ? 100
                              : key === "date_of_birth"
                                ? adultBirthDate()
                                : undefined
                          }
                          step={type === "number" ? "any" : undefined}
                          inputMode={
                            key === "ssn"
                              ? "numeric"
                              : type === "number"
                                ? "decimal"
                                : undefined
                          }
                          placeholder={
                            key === "ssn" ? "123-45-6789" : undefined
                          }
                          autoComplete="off"
                          value={String(owner[key as keyof typeof owner])}
                          maxLength={key === "ssn" ? 11 : 250}
                          onChange={(e) =>
                            changed({
                              ...data,
                              owners: data.owners.map((o, j) =>
                                j === i
                                  ? {
                                      ...o,
                                      [key]:
                                        type === "number"
                                          ? e.target.value === ""
                                            ? ""
                                            : Number(e.target.value)
                                          : key === "ssn"
                                            ? formatTaxId(e.target.value, "ssn")
                                            : e.target.value,
                                    }
                                  : o,
                              ),
                            })
                          }
                        />
                      )}
                    </label>
                    {fieldNotices(`owners.${i}.${key}` as ExtractionField)}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
          <label className="field">
            <span>
              {t(
                locale,
                "¿Hay un segundo propietario?",
                "Is there a second owner?",
              )}
              <span className="application-required" aria-hidden="true">
                {" "}
                *
              </span>
            </span>
            <select
              disabled={busy}
              aria-required="true"
              value={secondOwnerAnswer(data)}
              onChange={(e) =>
                changed({
                  ...data,
                  second_owner: e.target.value as "yes" | "no" | "unknown",
                  owners:
                    e.target.value === "yes"
                      ? data.owners.length > 1
                        ? data.owners
                        : [...data.owners, companyOwnerSchema.parse({})]
                      : e.target.value === "unknown"
                        ? data.owners
                        : data.owners.slice(0, 1),
                })
              }
            >
              <option value="unknown">
                {t(locale, "No identificado", "Not identified")}
              </option>
              <option value="no">{t(locale, "No", "No")}</option>
              <option value="yes">{t(locale, "Sí", "Yes")}</option>
            </select>
          </label>
          {fieldNotices("second_owner")}
          {secondOwnerAnswer(data) === "unknown" && (
            <p className="muted">
              {t(
                locale,
                "Confirma si hay un segundo propietario antes de generar el PDF.",
                "Confirm whether there is a second owner before generating the PDF.",
              )}
            </p>
          )}
          <h3>{t(locale, "Firma", "Signature")}</h3>
          {previousSignature && (
            <p>
              {t(locale, "Firmada por", "Signed by")} {previousSignature.name} ·{" "}
              {t(
                locale,
                "Representante autorizado",
                "Authorized representative",
              )}
            </p>
          )}
          <p>
            {t(
              locale,
              "Puedes generar un borrador sin firma o dibujar tu propia firma como representante autorizado. Para la firma del cliente, incorpora la aplicación ya firmada.",
              "Generate an unsigned draft or draw your own signature as authorized representative. For the customer’s signature, attach the signed application.",
            )}
          </p>
          <label className="document-review-confirm">
            <input
              type="checkbox"
              checked={wantSign}
              disabled={busy || loading}
              onChange={(e) => {
                setWantSign(e.target.checked);
                setMessage("");
                setPdfNotification(false);
                setSignature("");
                setAuthorized(false);
              }}
            />
            {t(
              locale,
              "Firmar como representante autorizado",
              "Sign as authorized representative",
            )}
          </label>
          {wantSign && (
            <>
              <p>
                <strong>{workspace.profile.name}</strong> ·{" "}
                {t(
                  locale,
                  "El PDF mostrará que firmas en representación de la empresa.",
                  "The PDF will identify you as signing on behalf of the business.",
                )}
              </p>
              {declaration ? (
                <details>
                  <summary>
                    {t(
                      locale,
                      "Declaraciones y autorización",
                      "Disclosures and authorization",
                    )}
                  </summary>
                  <p>{declaration}</p>
                </details>
              ) : (
                <p role="alert">
                  {t(
                    locale,
                    "Falta configurar el texto de declaraciones. Puedes guardar un borrador.",
                    "The disclosure text is not configured. You can save a draft.",
                  )}
                </p>
              )}
              <SignaturePad
                locale={locale}
                value={signature}
                onChange={setSignature}
                disabled={busy}
              />
              <label className="document-review-confirm">
                <input
                  type="checkbox"
                  checked={authorized}
                  onChange={(e) => setAuthorized(e.target.checked)}
                  disabled={busy}
                />
                {t(
                  locale,
                  "Confirmo que tengo autorización para firmar como representante y revisé los datos y las declaraciones.",
                  "I confirm I am authorized to sign as representative and reviewed the data and disclosures.",
                )}
              </label>
            </>
          )}
          <CompanyApplicationActions
            locale={locale}
            revision={revision}
            generatedRevision={generatedRevision}
            dirty={dirty}
            busy={busy || loading}
            saveDisabled={
              wantSign && (!signature || !authorized || !declaration)
            }
            generateDisabled={secondOwnerAnswer(data) === "unknown"}
            save={() => void save()}
            generate={() => void generate()}
          />
        </>
      )}
    </Modal>
  );
}
