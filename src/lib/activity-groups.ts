import type { Activity } from "./domain";

const DOCUMENT_REVIEW_INTERVAL_MS = 20 * 60 * 1000;

function isDocumentReview(activity: Activity) {
  // The current API records reviews as `document`; demo mode uses the command
  // name. Receipt and application events must remain separate. Unknown formats
  // stay visible as individual events rather than being guessed from keywords.
  return (
    !!activity.actor_id &&
    (activity.type === "review_document" ||
      (activity.type === "document" &&
        /^.+: (?:approved|received|correction)(?: — [\s\S]*)?$/.test(
          activity.body,
        )))
  );
}

export function groupDocumentReviewActivities(activities: readonly Activity[]) {
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
      isDocumentReview(adjacent) &&
      isDocumentReview(activity) &&
      gap >= 0 &&
      gap <= DOCUMENT_REVIEW_INTERVAL_MS
    ) {
      previous!.events.push(activity);
    } else {
      groups.push({ id: activity.id, events: [activity] });
    }
  }
  return groups;
}
