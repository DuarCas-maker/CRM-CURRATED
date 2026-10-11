"use client";
import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from "pdfjs-dist";
import type { Locale } from "@/lib/domain";
import { t } from "./ui";

export function GmailPdfPreview({
  url,
  name,
  locale,
}: {
  url: string;
  name: string;
  locale: Locale;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [rendering, setRendering] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let task: PDFDocumentLoadingTask | undefined;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const data = new Uint8Array(
          await (await fetch(url, { signal: controller.signal })).arrayBuffer(),
        );
        if (controller.signal.aborted) return;
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        task = pdfjs.getDocument({
          data,
          enableXfa: false,
          useWasm: false,
          disableFontFace: true,
          maxImageSize: 16_000_000,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        });
        const loaded = await task.promise;
        if (!controller.signal.aborted) setDocument(loaded);
      } catch {
        if (!controller.signal.aborted)
          setError(
            t(
              locale,
              "No se pudo mostrar el PDF. Puede estar protegido o dañado; revisa el correo de origen.",
              "Unable to display PDF. It may be protected or damaged; review the source email.",
            ),
          );
      }
    })();
    return () => {
      controller.abort();
      void task?.destroy();
    };
  }, [url, locale]);

  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    setRendering(true);
    (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (cancelled || !canvas.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(2, 1600 / Math.max(base.width, base.height));
        const viewport = pdfPage.getViewport({ scale });
        canvas.current.width = Math.ceil(viewport.width);
        canvas.current.height = Math.ceil(viewport.height);
        task = pdfPage.render({ canvas: canvas.current, viewport });
        await task.promise;
        if (!cancelled) setRendering(false);
      } catch {
        if (!cancelled)
          setError(
            t(
              locale,
              "No se pudo mostrar esta página del PDF.",
              "Unable to display this PDF page.",
            ),
          );
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [document, page, locale]);
  return (
    <div>
      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : (
        <>
          {rendering && (
            <p role="status">
              {t(locale, "Cargando página…", "Loading page…")}
            </p>
          )}
          <div className="gmail-pdf-canvas">
            <canvas
              ref={canvas}
              role="img"
              aria-label={`${name} · ${t(locale, "página", "page")} ${page}`}
            />
          </div>
          {document && (
            <div className="card-actions">
              <button
                className="button"
                disabled={rendering || page === 1}
                onClick={() => setPage(page - 1)}
              >
                {t(locale, "Página anterior", "Previous page")}
              </button>
              <span>
                {page} / {document.numPages}
              </span>
              <button
                className="button"
                disabled={rendering || page === document.numPages}
                onClick={() => setPage(page + 1)}
              >
                {t(locale, "Página siguiente", "Next page")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
