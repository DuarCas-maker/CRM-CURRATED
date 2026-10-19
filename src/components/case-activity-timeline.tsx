import type { ReactNode } from "react";
import type { Activity, Locale } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import { groupDocumentReviewActivities } from "@/lib/activity-groups";
import { t } from "./ui";

export function CaseActivityTimeline({
  activities,
  locale,
  renderEvent,
}: {
  activities: Activity[];
  locale: Locale;
  renderEvent: (activity: Activity) => ReactNode;
}) {
  return (
    <div className="timeline">
      {groupDocumentReviewActivities(activities).map(({ id, events }) =>
        events.length === 1 ? (
          renderEvent(events[0])
        ) : (
          <details className="timeline-event-group" key={id}>
            <summary>
              <strong>
                {t(
                  locale,
                  "Revisión y aprobación de documentos",
                  "Document review and approval",
                )}
              </strong>
              <span>
                {events.length} {t(locale, "eventos", "events")}
              </span>
              <span className="timeline-group-time">
                <time dateTime={events.at(-1)!.created_at}>
                  {dateLabel(events.at(-1)!.created_at, locale, true)}
                </time>
                {" – "}
                <time dateTime={events[0].created_at}>
                  {dateLabel(events[0].created_at, locale, true)}
                </time>
              </span>
            </summary>
            <div className="timeline-group-events">
              {events.map(renderEvent)}
            </div>
          </details>
        ),
      )}
    </div>
  );
}
