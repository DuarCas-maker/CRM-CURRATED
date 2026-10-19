import { renderTemplate, templateVariables } from "./domain";

export type CampaignFormat = "plain" | "markdown";
export const mergeFields = [
  "name",
  "company",
  "amount",
  "industry",
  "phone",
  "application_url",
  "unsubscribe_url",
] as const;
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Parse the author's limited formatting before inserting contact data. Values can
// never introduce markup, links or formatting, and raw HTML is always escaped.
export function renderCampaignContent(
  body: string,
  values: Record<string, string>,
  format: CampaignFormat = "plain",
) {
  const text = renderTemplate(body, values);
  if (format === "plain")
    return { text, html: escapeHtml(text).replace(/\r?\n/g, "<br>") };
  function inline(source: string): string {
    const pattern =
      /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^\s)]+)\)/g;
    let result = "",
      offset = 0;
    for (const match of source.matchAll(pattern)) {
      result += escapeHtml(
        renderTemplate(source.slice(offset, match.index), values),
      );
      if (match[1])
        result += `<strong>${escapeHtml(renderTemplate(match[1], values))}</strong>`;
      else if (match[2])
        result += `<em>${escapeHtml(renderTemplate(match[2], values))}</em>`;
      else {
        const url = renderTemplate(match[4], values);
        if (!/^https?:\/\//i.test(url) || /[\s\u0000-\u001f]/.test(url))
          throw new Error("Los enlaces deben usar https:// o http://.");
        result += `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(renderTemplate(match[3], values))}</a>`;
      }
      offset = match.index! + match[0].length;
    }
    return result + escapeHtml(renderTemplate(source.slice(offset), values));
  }
  let inList = false;
  const lines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const item = line.match(/^[-*] (.*)$/);
    if (item && !inList) {
      lines.push("<ul>");
      inList = true;
    }
    if (!item && inList) {
      lines.push("</ul>");
      inList = false;
    }
    lines.push(item ? `<li>${inline(item[1])}</li>` : `${inline(line)}<br>`);
  }
  if (inList) lines.push("</ul>");
  // Strip only authored formatting from the plain alternative, then merge data.
  const plainTemplate = body
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, "$1 ($2)");
  return { text: renderTemplate(plainTemplate, values), html: lines.join("") };
}

export function missingCampaignFields(
  subject: string,
  body: string,
  values: Record<string, string>,
  steps: { subject: string; body: string }[] = [],
) {
  return [
    ...new Set(
      templateVariables(
        [subject, body, ...steps.flatMap((s) => [s.subject, s.body])].join(
          "\n",
        ),
      ),
    ),
  ].filter((key) => !values[key]?.trim());
}
