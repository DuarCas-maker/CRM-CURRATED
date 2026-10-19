import { z } from "zod";
// Verbatim declaration from the application sample supplied by the user. Keep
// existing wording, including its typo; do not silently rewrite contractual text.
export const SAMPLE_APPLICATION_DECLARATION =
  "The above hereby authorizes Curated Financial, on a on exclusive basis, to seek financial transactions on its behalf from the date stated herein, and otherwise from time to time until any and all loans and/or revenue based financings are repaid in full and the relationship with the merchant is completed, including but not limited to for any renewal or for any purpose relating thereto.\n\nBy signing below, the Merchant and its owners/principals: (1) certify that all information and documents submitted in connection with this application are true, correct, and complete; and (2) authorize Curated Financial Inc. and its assignees/designees to obtain credit reports and any other information regarding the Merchant and its owners and principals to verify the information provided on the application.";
const text = z.string().trim().max(250).default("");
export const entityTypes = [
  "Sole Proprietorship",
  "LLC",
  "Corporation",
  "Partnership",
  "Limited Partnership",
  "Non-Profit",
] as const;
export const usStates = Object.entries({
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
});
export function formatTaxId(value: string, kind: "ein" | "ssn") {
  const digits = value.replace(/\D/g, "").slice(0, 9);
  const groups = kind === "ein" ? [2, 7] : [3, 2, 4];
  let offset = 0;
  return groups
    .map((size) => {
      const part = digits.slice(offset, offset + size);
      offset += size;
      return part;
    })
    .filter(Boolean)
    .join("-");
}
export function adultBirthDate(today = new Date()) {
  const year = today.getUTCFullYear() - 18,
    month = today.getUTCMonth();
  const day = Math.min(
    today.getUTCDate(),
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
  );
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}
export const companyOwnerSchema = z.object({
  name: text,
  email: text,
  ssn: text,
  date_of_birth: text,
  phone: text,
  address: text,
  city: text,
  state: text,
  zip: text,
  ownership: z
    .union([z.literal(""), z.coerce.number().min(0).max(100)])
    .default(""),
});
export const companyApplicationSchema = z.object({
  legal_name: text,
  entity_type: text,
  ein: text,
  incorporation_state: text,
  inception_date: text,
  business_address: text,
  business_city: text,
  business_state: text,
  business_zip: text,
  owners: z.array(companyOwnerSchema).min(1).max(2),
  second_owner: z.enum(["yes", "no", "unknown"]).optional(),
  commercial_name: text,
  commercial_email: text,
  identifier: text,
});
export type CompanyApplication = z.infer<typeof companyApplicationSchema>;
export const representativeSignatureSchema = z.object({
  image: z
    .string()
    .max(180000)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/),
  authorized: z.literal(true),
});
export type ApplicationSignature = {
  image: string;
  name: string;
  actor_id: string;
  signed_at: string;
  capacity: "authorized_representative";
};
export type CompanyApplicationRecord = {
  data: CompanyApplication;
  signature: ApplicationSignature | null;
  declaration?: string | null;
};
export function emptyCompanyApplication(company = ""): CompanyApplication {
  return companyApplicationSchema.parse({
    legal_name: company,
    owners: [{}],
    second_owner: "unknown",
  });
}
export const requiredBusinessFields = [
  "legal_name",
  "entity_type",
  "ein",
  "incorporation_state",
  "inception_date",
] as const;
export const requiredOwnerFields = [
  "name",
  "ssn",
  "date_of_birth",
  "ownership",
] as const;
export function secondOwnerAnswer(data: CompanyApplication) {
  // Existing records predate the explicit unknown state.
  return data.second_owner ?? (data.owners.length > 1 ? "yes" : "no");
}
export function bindApplicationAdvisor(
  data: CompanyApplication,
  advisors: { id: string; name: string; email: string }[],
) {
  if (!data.commercial_email)
    return { ...data, commercial_name: "", identifier: "" };
  const advisor = advisors.find(
    (a) => a.email.toLowerCase() === data.commercial_email.toLowerCase(),
  );
  if (!advisor)
    throw new Error(
      "Selecciona un comercial activo / Select an active advisor",
    );
  return {
    ...data,
    commercial_email: advisor.email,
    commercial_name: advisor.name,
    identifier: advisor.id,
  };
}
export function applicationFilename(data: CompanyApplication) {
  const clean = (value: string) =>
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 70)
      .replace(/[. ]+$/, "");
  return `Application - ${clean(data.legal_name) || "Company"} - ${clean(data.owners[0]?.name || "") || "Owner"}.pdf`;
}
export function validateCompleteApplication(data: CompanyApplication) {
  const second = secondOwnerAnswer(data);
  if (second === "unknown" || (second === "yes") !== (data.owners.length === 2))
    throw new Error(
      "Confirma si hay un segundo propietario / Confirm whether there is a second owner",
    );
  if (requiredBusinessFields.some((key) => !data[key]))
    throw new Error(
      "Completa los campos obligatorios / Complete required application fields",
    );
  if (
    !entityTypes.includes(data.entity_type as (typeof entityTypes)[number]) ||
    !/^\d{2}-\d{7}$/.test(data.ein) ||
    !validDate(data.inception_date) ||
    data.inception_date > new Date().toISOString().slice(0, 10) ||
    !validState(data.incorporation_state) ||
    !validState(data.business_state) ||
    (data.commercial_email &&
      !z.email().safeParse(data.commercial_email).success)
  )
    throw new Error(
      "Verifica entidad, EIN, estado, fecha y correo / Check entity, EIN, state, date and email",
    );
  for (const o of data.owners)
    if (
      [o.name, o.ssn, o.date_of_birth].some((v) => !v) ||
      (o.email && !z.email().safeParse(o.email).success) ||
      !/^\d{3}-\d{2}-\d{4}$/.test(o.ssn) ||
      !validDate(o.date_of_birth) ||
      o.date_of_birth > adultBirthDate() ||
      !validState(o.state) ||
      o.ownership === "" ||
      !Number.isFinite(o.ownership) ||
      o.ownership < 0 ||
      o.ownership > 100
    )
      throw new Error(
        "Verifica los datos obligatorios de los propietarios, SSN y edad mínima de 18 años / Check required owner details, SSN and minimum age of 18",
      );
  if (data.owners.reduce((sum, o) => sum + Number(o.ownership), 0) > 100)
    throw new Error(
      "La propiedad no puede superar el 100% / Ownership cannot exceed 100%",
    );
}
function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function validState(value: string) {
  return !value || usStates.some(([code]) => code === value);
}
