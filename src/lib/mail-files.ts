import type { AttachmentProcessingStatus } from "./attachment-processing";
export type MailVisibleFile = {
  message_id: string;
  id: string;
  name: string;
  href: string;
  last_error?: string | null;
  review_source?: "saved";
  imported_document_id?: string | null;
  processing_status?: AttachmentProcessingStatus;
};
