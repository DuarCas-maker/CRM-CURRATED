import type { Workspace } from "./domain";

// Keep the editor's existing approval and storage rules for both individual and
// bulk selection. The send endpoint still enforces size, access and snapshots.
export function availableMailAttachments(data: Workspace, caseId: string) {
  return {
    documents: data.documents.filter(
      (d) =>
        d.opportunity_id === caseId &&
        d.status === "approved" &&
        d.storage_path,
    ),
    gmailFiles: (data.gmail_files || []).filter(
      (f) =>
        f.opportunity_id === caseId &&
        f.storage_path &&
        (data.gmail_history_enabled
          ? ["received", "approved", "reviewed", "incorporated"]
          : ["approved"]
        ).includes(f.status),
    ),
  };
}

export function selectAllMailAttachments(
  available: ReturnType<typeof availableMailAttachments>,
  selected: {
    documents: string[];
    gmailFiles: string[];
    uploads: number;
    forwards: number;
  },
) {
  const documents = [
    ...new Set([
      ...selected.documents,
      ...available.documents.map((d) => d.id),
    ]),
  ];
  const gmailFiles = [
    ...new Set([
      ...selected.gmailFiles,
      ...available.gmailFiles.map((f) => f.id),
    ]),
  ];
  if (
    gmailFiles.length > 10 ||
    documents.length +
      gmailFiles.length +
      selected.uploads +
      selected.forwards >
      20
  )
    return null;
  return { documents, gmailFiles };
}
