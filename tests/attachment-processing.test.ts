import test from "node:test";
import assert from "node:assert/strict";
import { attachmentProcessingStatus } from "../src/lib/attachment-processing";
import { attachmentProcessing } from "../src/lib/server/attachment-processing";
import type { SupabaseClient } from "@supabase/supabase-js";

const review = (
  content_hash: string,
  status = "approved",
  reviewed_at = "2026-10-14T20:00:00Z",
) => ({
  document_id: "document",
  content_hash,
  status,
  reviewed_at,
});

test("processed attachments require a link and a review of their exact version", () => {
  assert.equal(
    attachmentProcessingStatus(null, ["original"], [review("original")]),
    "pending",
  );
  assert.equal(
    attachmentProcessingStatus("document", ["original"], []),
    "linked",
  );
  assert.equal(
    attachmentProcessingStatus(
      "document",
      ["original"],
      [review("replacement")],
    ),
    "linked",
  );
  assert.equal(
    attachmentProcessingStatus("document", ["original"], [review("original")]),
    "processed",
  );
  assert.equal(
    attachmentProcessingStatus(
      "other-document",
      ["original"],
      [review("original")],
    ),
    "linked",
  );
  assert.equal(
    attachmentProcessingStatus(
      "document",
      ["original"],
      [
        review("original"),
        review("original", "correction", "2026-10-14T21:00:00Z"),
      ],
    ),
    "correction",
  );
  assert.equal(
    attachmentProcessingStatus(
      "document",
      ["original"],
      [
        review("original"),
        review("replacement", "correction", "2026-10-14T21:00:00Z"),
      ],
    ),
    "processed",
  );
});

test("saved and legacy mail attachments receive the status of their own source version", async () => {
  const rows: Record<string, any[]> = {
    document_versions: [
      {
        document_id: "document",
        content_hash: "original",
        source_gmail_file_id: "saved",
        source_attachment_id: null,
      },
      {
        document_id: "document",
        content_hash: "replacement",
        source_gmail_file_id: null,
        source_attachment_id: "legacy",
      },
    ],
    document_reviews: [review("original")],
  };
  const db = {
    from(table: string) {
      const query = {
        select() {
          return query;
        },
        in() {
          return query;
        },
        order() {
          return query;
        },
        async range() {
          return { data: rows[table], error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const result = await attachmentProcessing(
    db,
    [{ id: "saved", imported_document_id: "document", review_source: "saved" }],
    [{ id: "legacy", imported_document_id: "document" }],
  );
  assert.equal(result.files[0].processing_status, "processed");
  assert.equal(result.attachments[0].processing_status, "linked");
});
