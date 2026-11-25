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
  "monthly_income", "sender_email",
  "funding_amount_6", "funding_amount_9", "funding_amount_12",
  "funding_payment_6", "funding_payment_9", "funding_payment_12",
  "funding_weeks_6", "funding_weeks_9", "funding_weeks_12",
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
        const emailLink = /^mailto:[^\s?@]+@[^\s?@]+\.[^\s?@]+$/i.test(url);
        if (
          (!/^https?:\/\//i.test(url) && !emailLink) ||
          /[\s\u0000-\u001f]/.test(url)
        )
          throw new Error(
            "Los enlaces deben usar https://, http:// o mailto:.",
          );
        result += `<a href="${escapeHtml(url)}" style="color:#0655d4;text-decoration:underline;" rel="noopener noreferrer">${inline(match[3])}</a>`;
      }
      offset = match.index! + match[0].length;
    }
    return result + escapeHtml(renderTemplate(source.slice(offset), values));
  }
  let inList = false;
  const lines: string[] = [];
  const sourceLines = body.split(/\r?\n/);
  const plainLines: string[] = [];
  const plain = (source: string) =>
    renderTemplate(
      source
        .replace(/\*\*([^*\n]+)\*\*/g, "$1")
        .replace(/\*([^*\n]+)\*/g, "$1")
        .replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, "$1 ($2)"),
      values,
    );
  const cells = (line: string) =>
    /^\s*\|.*\|\s*$/.test(line)
      ? line
          .trim()
          .slice(1, -1)
          .split(/(?<!\\)\|/)
          .map((cell) => cell.trim().replace(/\\\|/g, "|"))
      : null;
  function closeList() {
    if (inList) {
      lines.push("</ul>");
      inList = false;
    }
  }
  for (let index = 0; index < sourceLines.length; index++) {
    const line = sourceLines[index];
    if (line.trim() === ":::signature") {
      closeList();
      const signature: string[] = [];
      while (
        ++index < sourceLines.length &&
        sourceLines[index].trim() !== ":::"
      )
        signature.push(sourceLines[index]);
      if (index === sourceLines.length)
        throw new Error("Falta cerrar el bloque de firma con :::.");
      lines.push(
        `<div data-crm-signature="true" style="font-family:Arial,Helvetica,sans-serif;">${signature.map(inline).join("<br>")}</div>`,
      );
      plainLines.push(...signature.map(plain));
      continue;
    }
    const directive = line.trim().match(/^:::table (black|blue|funding)$/);
    if (line.trim().startsWith(":::table") && !directive)
      throw new Error("El color de tabla debe ser black, blue o funding.");
    const headingIndex = directive ? index + 1 : index;
    const heading = cells(sourceLines[headingIndex] || "");
    const separator = cells(sourceLines[headingIndex + 1] || "");
    if (heading && separator?.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      closeList();
      if (heading.length !== separator.length || heading.length > 8)
        throw new Error("Revisa las columnas de la tabla.");
      const funding = directive?.[1] === "funding";
      const blue = directive?.[1] === "blue",
        color = funding ? "#d9a441" : blue ? "#214784" : "#000000";
      const border = funding ? "border-bottom:1px solid #dbe4ed;" : blue ? "border:0;" : "border:1px solid #000000;";
      const rowCells = (row: string[], header = false) =>
        row
          .map((cell, i) => {
            const tag = header ? "th" : "td";
            return `<${tag} style="${border}padding:${funding ? "12px" : header ? "4px" : "2px 3px"};text-align:${header ? "center" : separator![i].endsWith(":") ? "right" : "left"};vertical-align:top;${header ? `background-color:${color};color:${funding ? "#102d4d" : "#ffffff"};font-weight:bold;` : "color:#111111;background-color:#ffffff;"}">${inline(cell)}</${tag}>`;
          })
          .join("");
      const merged = heading.length === 2 && !heading[1];
      let html = `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${color};width:${funding ? "100%" : (blue ? 212 : 238) + "px"};max-width:100%;margin:0 0 ${blue || funding ? 18 : 0}px;font-family:Arial,Helvetica,sans-serif;font-size:${funding ? 14 : 12}px;line-height:18px;"><thead><tr>${merged ? `<th colspan="2" style="padding:4px;background-color:${color};color:#ffffff;font-weight:bold;text-align:center;">${inline(heading[0])}</th>` : rowCells(heading, true)}</tr></thead><tbody>`;
      plainLines.push(plain(heading.filter(Boolean).join(" | ")));
      index = headingIndex + 2;
      let rows = 0;
      for (; index < sourceLines.length; index++) {
        const row = cells(sourceLines[index]);
        if (!row) break;
        if (row.length !== heading.length || ++rows > 50)
          throw new Error("Revisa las filas de la tabla (máximo 50).");
        html += `<tr>${rowCells(row)}</tr>`;
        plainLines.push(plain(row.join(": ")));
      }
      if (directive && sourceLines[index]?.trim() !== ":::")
        throw new Error("Falta cerrar la tabla con :::.");
      if (!directive) index--;
      lines.push(html + "</tbody></table>");
      continue;
    }
    if (directive)
      throw new Error("La tabla necesita encabezado, separador y filas.");
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
    plainLines.push(plain(line));
  }
  if (inList) lines.push("</ul>");
  const html = lines.join("");
  return { text: plainLines.join("\n"), html: /^:::table funding$/m.test(body)
    ? `<div style="background:#f2f5f8;padding:24px 12px;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dbe4ed;border-radius:12px;overflow:hidden;"><div style="background:#102d4d;color:white;padding:20px 24px;font:700 22px Arial,Helvetica,sans-serif;">Curated Financial</div><div style="padding:24px;font:14px/1.6 Arial,Helvetica,sans-serif;color:#243746;">${html}</div></div></div>` : html };
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
