import { z } from "zod";
// Verbatim declaration from the application sample supplied by the user. Keep
// existing wording, including its typo; do not silently rewrite contractual text.
export const SAMPLE_APPLICATION_DECLARATION =
  "The above hereby authorizes Curated Financial, on a on exclusive basis, to seek financial transactions on its behalf from the date stated herein, and otherwise from time to time until any and all loans and/or revenue based financings are repaid in full and the relationship with the merchant is completed, including but not limited to for any renewal or for any purpose relating thereto.\n\nBy signing below, the Merchant and its owners/principals: (1) certify that all information and documents submitted in connection with this application are true, correct, and complete; and (2) authorize Curated Financial Inc. and its assignees/designees to obtain credit reports and any other information regarding the Merchant and its owners and principals to verify the information provided on the application.";
const text = z.string().trim().max(250).default("");
export const companyOwnerSchema = z.object({
  name: text,
  email: text,
  ssn: text,
  date_of_birth: text,
  phone: text,
  address: text,
  ownership: z.coerce.number().min(0).max(100).default(0),
});
export const companyApplicationSchema = z.object({
  legal_name: text,
  entity_type: text,
  ein: text,
  incorporation_state: text,
  inception_date: text,
  business_address: text,
  owners: z.array(companyOwnerSchema).min(1).max(2),
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
  return companyApplicationSchema.parse({ legal_name: company, owners: [{}] });
}
export function validateCompleteApplication(data: CompanyApplication) {
  if (
    [
      data.legal_name,
      data.entity_type,
      data.ein,
      data.incorporation_state,
      data.inception_date,
      data.business_address,
      data.commercial_name,
      data.commercial_email,
      data.identifier,
    ].some((v) => !v)
  )
    throw new Error(
      "Completa todos los campos de la aplicación / Complete every application field",
    );
  if (
    !/^\d{2}-?\d{7}$/.test(data.ein) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.inception_date) ||
    !z.email().safeParse(data.commercial_email).success
  )
    throw new Error("Verifica EIN, fecha y correo / Check EIN, date and email");
  for (const o of data.owners)
    if (
      [o.name, o.email, o.ssn, o.date_of_birth, o.phone, o.address].some(
        (v) => !v,
      ) ||
      !z.email().safeParse(o.email).success ||
      !/^\d{3}-?\d{2}-?\d{4}$/.test(o.ssn) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(o.date_of_birth) ||
      o.ownership <= 0
    )
      throw new Error(
        "Completa y verifica la información de los propietarios / Complete and verify owner information",
      );
  if (data.owners.reduce((sum, o) => sum + o.ownership, 0) > 100)
    throw new Error(
      "La propiedad no puede superar el 100% / Ownership cannot exceed 100%",
    );
}
