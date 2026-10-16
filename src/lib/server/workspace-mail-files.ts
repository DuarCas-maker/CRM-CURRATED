import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "../domain";
import type { MailVisibleFile } from "../mail-files";
import { messageFiles } from "./mail-manager";
import { attachmentProcessing } from "./attachment-processing";

// Match activity's attachments to the same visible messages as the conversation
// reader, with bounded URL sizes even for a large case history.
export async function loadWorkspaceMailFiles(
  db: SupabaseClient,
  messages: Workspace["messages"],
  attachments: NonNullable<Workspace["attachments"]>,
) {
  const files: MailVisibleFile[] = [];
  for (let i = 0; i < messages.length; i += 50) {
    files.push(...(await messageFiles(db, messages.slice(i, i + 50))));
  }
  return attachmentProcessing(db, files, attachments);
}
