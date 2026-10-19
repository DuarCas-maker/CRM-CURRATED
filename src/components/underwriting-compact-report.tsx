import type { Locale } from "@/lib/domain";
import type { UnderwritingDraft, UnderwritingRun } from "@/lib/underwriting";
import { compactReportBlocks } from "@/lib/underwriting-compact";
export function UnderwritingCompactReport({
  report,
  locale,
  documents,
}: {
  report: UnderwritingDraft;
  locale: Locale;
  documents: UnderwritingRun["document_snapshot"];
}) {
  return (
    <article className="underwriting-compact-report" lang={locale}>
      {compactReportBlocks(report, locale, documents).map((block, i) =>
        block.kind === "table" ? (
          <div className="table-scroll" key={i}>
            <table>
              <thead>
                <tr>
                  {block.headers.map((h, n) => (
                    <th key={n}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, n) => (
                  <tr key={n}>
                    {row.map((value, k) => (
                      <td key={k}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : block.kind === "heading" ? (
          <h3 key={i}>{block.text}</h3>
        ) : block.kind === "bullet" ? (
          <p className="underwriting-compact-bullet" key={i}>
            • {block.text}
          </p>
        ) : (
          <p key={i}>{block.text}</p>
        ),
      )}
    </article>
  );
}
