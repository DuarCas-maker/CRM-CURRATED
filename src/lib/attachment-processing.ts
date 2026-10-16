export type AttachmentProcessingStatus =
  "pending" | "linked" | "processed" | "correction";

export function attachmentProcessingStatus(
  documentId: string | null | undefined,
  versionHashes: string[],
  reviews: {
    document_id: string;
    content_hash: string;
    status: string;
    reviewed_at: string;
  }[],
): AttachmentProcessingStatus {
  if (!documentId) return "pending";
  const latest = reviews
    .filter(
      (r) =>
        r.document_id === documentId && versionHashes.includes(r.content_hash),
    )
    .sort((a, b) => Date.parse(b.reviewed_at) - Date.parse(a.reviewed_at))[0];
  if (!latest) return "linked";
  if (latest.status === "correction") return "correction";
  return ["approved", "received"].includes(latest.status)
    ? "processed"
    : "linked";
}

export const attachmentProcessingLabels = {
  pending: ["Incorporar y revisar", "Add and review"],
  linked: ["Vinculado · pendiente de revisión", "Linked · awaiting review"],
  processed: ["Vinculado y revisado", "Linked and reviewed"],
  correction: [
    "Revisado · requiere corrección",
    "Reviewed · correction required",
  ],
} as const;
