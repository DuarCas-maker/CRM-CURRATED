import { z } from "zod";
export const applicationSchema = z.object({
  legal_name: z.string().trim().min(2).max(150),
  dba: z.string().max(150).default(""),
  entity_type: z.enum(["LLC", "Corporation", "Partnership", "Sole proprietor"]),
  ein: z.string().regex(/^\d{2}-?\d{7}$/),
  business_phone: z.string().min(7).max(30),
  business_email: z.email(),
  address: z.string().min(5).max(250),
  city: z.string().min(2).max(100),
  state: z.string().length(2),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/),
  established: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  industry: z.string().min(2).max(100),
  annual_revenue: z.coerce.number().min(0),
  requested_amount: z.coerce.number().positive(),
  purpose: z.string().min(3).max(2000),
  owners: z
    .array(
      z.object({
        name: z.string().min(2).max(150),
        title: z.string().min(1).max(100),
        email: z.email(),
        phone: z.string().min(7).max(30),
        ownership: z.coerce.number().min(1).max(100),
        address: z.string().min(5).max(250),
      }),
    )
    .min(1)
    .max(4)
    .refine(
      (owners) => owners.reduce((sum, o) => sum + o.ownership, 0) <= 100,
      "Ownership cannot exceed 100%",
    ),
  signature_name: z.string().trim().min(2).max(150),
  consent: z.literal(true),
});
export type ApplicationInput = z.infer<typeof applicationSchema>;
export const demoDeclaration =
  "I certify that the information provided in this application is accurate to the best of my knowledge. I consent to be contacted about this financing request. This demonstration text must be replaced with the approved Curated Financial declarations before accepting real applications.";
