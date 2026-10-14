import { z } from "zod";
export const documentSourceSchema = z.enum(["saved", "legacy", "document"]);
export type DocumentSource = z.infer<typeof documentSourceSchema>;
export type DocumentSelection = { source: DocumentSource; id: string };
export const documentReviewSchema = z
  .object({
    opportunity_id: z.uuid(),
    document_id: z.uuid(),
    expected_hash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["received", "approved", "correction"]),
    notes: z.string().trim().max(4000).default(""),
    period: z.string().max(100),
  })
  .refine((p) => p.status !== "correction" || !!p.notes, {
    message: "Explain the requested correction",
  });
export const incorporateDocumentSchema = z.object({
  opportunity_id: z.uuid(),
  document_id: z.uuid(),
  source: z.enum(["saved", "legacy"]),
  source_id: z.uuid(),
  expected_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export function previewMime(bytes: Uint8Array): string | null {
  if (String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-")
    return "application/pdf";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    return "image/png";
  return null;
}
