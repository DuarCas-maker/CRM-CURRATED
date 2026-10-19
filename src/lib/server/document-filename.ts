import { PDFDocument } from "pdf-lib";
export function documentFilename(name: string, path: string) {
  const safe =
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180)
      .replace(/[. ]+$/, "") || "Document";
  const extension = /\.(pdf|jpg|jpeg|png)$/i.exec(path)?.[0] || "";
  return /\.(pdf|jpg|jpeg|png)$/i.test(safe) ? safe : safe + extension;
}
// The name lives with immutable PDF bytes, so edits to a company's current draft
// cannot rename an approved or queued application from an older revision.
export async function applicationPdfFilename(
  bytes: Uint8Array,
  fallback: string,
) {
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const title = pdf.getTitle();
    if (
      pdf.getProducer() === "Curated Financial Application" &&
      title?.startsWith("Application - ")
    )
      return documentFilename(title, "file.pdf");
  } catch {
    /* Legacy or uploaded files retain their original document label. */
  }
  return fallback;
}
