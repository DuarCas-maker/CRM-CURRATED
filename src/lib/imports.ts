import { normalizeEmail, validEmail } from "./domain";
export type Mapping = Record<
  "email" | "contact" | "company" | "phone" | "industry",
  string
>;
const aliases: Record<keyof Mapping, string[]> = {
  email: [
    "email",
    "emailaddress",
    "correo",
    "correoelectronico",
    "e-mail",
    "business email",
  ],
  contact: [
    "name",
    "fullname",
    "contact",
    "contactname",
    "nombre",
    "nombrecompleto",
    "owner",
    "firstname",
  ],
  company: [
    "company",
    "businessname",
    "business",
    "empresa",
    "companyname",
    "legalname",
  ],
  phone: ["phone", "phonenumber", "telefono", "mobile", "cell"],
  industry: ["industry", "sector", "industria", "business type"],
};
const headerKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f\s_\-]/g, "");
export function detectMapping(headers: string[]): Mapping {
  return Object.fromEntries(
    Object.entries(aliases).map(([key, names]) => [
      key,
      headers.find((h) => names.some((n) => headerKey(n) === headerKey(h))) ||
        "",
    ]),
  ) as Mapping;
}
export function normalizeRow(row: Record<string, unknown>, mapping: Mapping) {
  const field = (key: keyof Mapping) => String(row[mapping[key]] ?? "").trim();
  const email = normalizeEmail(field("email"));
  if (!validEmail(email))
    return {
      valid: false as const,
      error: email ? "invalid_email" : "missing_email",
    };
  return {
    valid: true as const,
    email,
    contact: field("contact"),
    company: field("company"),
    phone: field("phone"),
    industry: field("industry"),
  };
}
