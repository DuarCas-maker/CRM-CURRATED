import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "../src/lib/domain";
import { loadWorkspaceMailFiles } from "../src/lib/server/workspace-mail-files";

test("activity retains every archived attachment with bounded queries and isolates copies of a Gmail message linked to another case", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-only";
  try {
    const messages = Array.from({ length: 120 }, (_, i) => ({
      id: `m${i}`,
      conversation_id: "conversation",
      archive_message_id: `archive${i}`,
    })) as Workspace["messages"];
    const files = Array.from({ length: 1005 }, (_, i) => ({
      id: `file${i}`,
      opportunity_id: "case",
      archive_message_id: "archive0",
      name: `document${i}.pdf`,
      imported_document_id: null,
    }));
    const tables: Record<string, Record<string, unknown>[]> = {
      conversations: [{ id: "conversation", opportunity_id: "case" }],
      gmail_saved_attachments: [
        ...files,
        { ...files[0], id: "private-file", opportunity_id: "another-case" },
      ],
    };
    const db = {
      from(table: string) {
        const filters: [string, unknown[]][] = [];
        const rows = () =>
          (tables[table] || []).filter((r) =>
            filters.every(([column, values]) => values.includes(r[column])),
          );
        const query = {
          select() {
            return query;
          },
          order() {
            return query;
          },
          in(column: string, values: unknown[]) {
            assert(values.length <= 50);
            filters.push([column, values]);
            return query;
          },
          async range(from: number, until: number) {
            return { data: rows().slice(from, until + 1), error: null };
          },
          then(
            resolve: (value: unknown) => unknown,
            reject: (error: unknown) => unknown,
          ) {
            return Promise.resolve({ data: rows(), error: null }).then(
              resolve,
              reject,
            );
          },
        };
        return query;
      },
    } as unknown as SupabaseClient;
    const result = await loadWorkspaceMailFiles(db, messages, []);
    assert.equal(result.files.length, 1005);
    assert(!result.files.some((f) => f.id === "private-file"));
    assert(
      result.files.every(
        (f) => f.message_id === "m0" && f.review_source === "saved",
      ),
    );
    assert.equal(result.files.at(-1)?.href, "/api/gmail/files/file1004");
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
