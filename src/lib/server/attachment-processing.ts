import type { SupabaseClient } from "@supabase/supabase-js";
import { attachmentProcessingStatus } from "../attachment-processing";
import { checkDb } from "./supabase";

// Use the source version's review, even when the checklist now holds a replacement.
// These reads use the caller's RLS client, including document review permissions.
export async function attachmentProcessing<
  F extends {
    id: string;
    imported_document_id?: string | null;
    review_source?: "saved";
  },
  A extends { id: string; imported_document_id?: string | null },
>(db: SupabaseClient, files: F[], attachments: A[]) {
  const documentIds = [
    ...new Set(
      [...files, ...attachments]
        .map((f) => f.imported_document_id)
        .filter((id): id is string => !!id),
    ),
  ];
  if (!documentIds.length)
    return {
      files: files.map((f) => ({
        ...f,
        processing_status: attachmentProcessingStatus(null, [], []),
      })),
      attachments: attachments.map((f) => ({
        ...f,
        processing_status: attachmentProcessingStatus(null, [], []),
      })),
    };
  const versions: {
    document_id: string;
    content_hash: string;
    source_gmail_file_id: string | null;
    source_attachment_id: string | null;
  }[] = [];
  const reviews: {
    document_id: string;
    content_hash: string;
    status: string;
    reviewed_at: string;
  }[] = [];
  for (let i = 0; i < documentIds.length; i += 50) {
    const ids = documentIds.slice(i, i + 50);
    for (const table of ["document_versions", "document_reviews"] as const) {
      const columns =
        table === "document_versions"
          ? "id,document_id,content_hash,source_gmail_file_id,source_attachment_id"
          : "id,document_id,content_hash,status,reviewed_at";
      for (let page = 0; ; page++) {
        const rows =
          checkDb(
            await db
              .from(table)
              .select(columns)
              .in("document_id", ids)
              .order("id")
              .range(page * 1000, page * 1000 + 999),
          ) || [];
        if (table === "document_versions")
          versions.push(...(rows as typeof versions));
        else reviews.push(...(rows as typeof reviews));
        if (rows.length < 1000) break;
      }
    }
  }
  const status = (
    file: { id: string; imported_document_id?: string | null },
    source: "saved" | "legacy",
  ) =>
    attachmentProcessingStatus(
      file.imported_document_id,
      versions
        .filter(
          (v) =>
            v.document_id === file.imported_document_id &&
            (source === "saved"
              ? v.source_gmail_file_id
              : v.source_attachment_id) === file.id,
        )
        .map((v) => v.content_hash),
      reviews,
    );
  return {
    files: files.map((f) => ({
      ...f,
      processing_status: f.review_source ? status(f, "saved") : undefined,
    })),
    attachments: attachments.map((f) => ({
      ...f,
      processing_status: status(f, "legacy"),
    })),
  };
}
