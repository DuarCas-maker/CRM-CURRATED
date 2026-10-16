"use client";
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
  type CompanyApplication,
  type ApplicationSignature,
} from "@/lib/company-application";
import { SignaturePad } from "./signature-pad";
import { Modal, t } from "./ui";
const fields: [
  keyof Omit<CompanyApplication, "owners">,
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
  ["identifier", "Identificador", "Identifier"],
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
    [dirty, setDirty] = useState(false),
    [declaration, setDeclaration] = useState<string | null>(
      workspace.demo ? SAMPLE_APPLICATION_DECLARATION : null,
    );
  const [declarationHash, setDeclarationHash] = useState<string | null>(null);
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
        if (b.record) {
          const loaded = companyApplicationSchema.parse(b.record.data);
          // Preserve signed snapshots; only fill missing advisor details in drafts.
          if (!b.record.signature && b.defaults) {
            for (const key of [
              "commercial_name",
              "commercial_email",
              "identifier",
            ] as const)
              if (!loaded[key] && b.defaults[key]) {
                loaded[key] = b.defaults[key];
                setDirty(true);
              }
          }
          setData(loaded);
          setPreviousSignature(b.record.signature);
        }
        if (!b.record && b.defaults)
          setData(companyApplicationSchema.parse(b.defaults));
        setRevision(b.revision);
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
    setDirty(true);
    setSignature("");
    setAuthorized(false);
    setPreviousSignature(null);
    setMessage("");
  }
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (workspace.demo) {
        setRevision((v) => v + 1);
        setDirty(false);
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
      setRevision(b.revision);
      setDirty(false);
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
      await refresh();
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
      wide
      title={t(locale, "Aplicación de la empresa", "Company application")}
      close={() => {
        if (!busy) close();
      }}
    >
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
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
          <p className="muted">
            {t(
              locale,
              "Obligatorios para generar PDF: nombre legal, entidad, EIN, estado de constitución, inicio del negocio y nombre, SSN, nacimiento y participación de cada propietario. Puedes guardar un borrador incompleto.",
              "Required for PDF: legal name, entity, EIN, incorporation state, inception date, and each owner's name, SSN, birth date and ownership. You can save an incomplete draft.",
            )}
          </p>
          <div className="company-application-fields">
            {fields.map(([key, es, en, type]) => (
              <label className="field" key={key}>
                {t(locale, es, en)}
                {key === "entity_type" ||
                key === "incorporation_state" ||
                key === "business_state" ? (
                  <select
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
                  <label className="field" key={key}>
                    {t(locale, es, en)}
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
                        placeholder={key === "ssn" ? "123-45-6789" : undefined}
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
                ))}
              </div>
            </fieldset>
          ))}
          <label className="field">
            {t(
              locale,
              "¿Hay un segundo propietario?",
              "Is there a second owner?",
            )}
            <select
              disabled={busy}
              value={data.owners.length > 1 ? "yes" : "no"}
              onChange={(e) =>
                changed({
                  ...data,
                  owners:
                    e.target.value === "yes"
                      ? [...data.owners, companyOwnerSchema.parse({})]
                      : data.owners.slice(0, 1),
                })
              }
            >
              <option value="no">{t(locale, "No", "No")}</option>
              <option value="yes">{t(locale, "Sí", "Yes")}</option>
            </select>
          </label>
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
                setDirty(true);
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
          <div className="modal-footer">
            <button
              className="button"
              disabled={
                busy ||
                loading ||
                (!dirty && revision > 0) ||
                (wantSign && (!signature || !authorized || !declaration))
              }
              onClick={() => void save()}
            >
              {t(locale, "Guardar aplicación", "Save application")}
            </button>
            <button
              className="button primary"
              disabled={busy || loading || dirty || !revision}
              onClick={() => void generate()}
            >
              {t(locale, "Generar PDF e incorporar", "Generate PDF and attach")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
