import type { Activity } from "./domain";

const DOCUMENT_ACTIVITY_INTERVAL_MS = 20 * 60 * 1000;
// Production uses `document` for both receipts and reviews, and `application`
// for public submissions. Demo mode records the corresponding command names.
// Group by event type so wording, language and missing actors do not split a
// document workflow into individual rows. Communications retain their own rows.
const documentActivityTypes = new Set([
  "document",
  "application",
  "review_document",
  "receive_document",
  "receive_upload_demo",
  "incorporate_document",
  "upload_demo",
  "initialize_document_checklist",
  "company_application_generated",
]);

export function groupDocumentActivities(activities: readonly Activity[]) {
  const ordered = [...activities].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const groups: { id: string; events: Activity[] }[] = [];
  for (const activity of ordered) {
    const previous = groups.at(-1);
    const adjacent = previous?.events.at(-1);
    const gap = adjacent
      ? Date.parse(adjacent.created_at) - Date.parse(activity.created_at)
      : NaN;
    if (
      adjacent &&
      adjacent.opportunity_id === activity.opportunity_id &&
      documentActivityTypes.has(adjacent.type) &&
      documentActivityTypes.has(activity.type) &&
      gap >= 0 &&
      gap <= DOCUMENT_ACTIVITY_INTERVAL_MS
    ) {
      previous!.events.push(activity);
    } else {
      groups.push({ id: activity.id, events: [activity] });
    }
  }
  return groups;
}
