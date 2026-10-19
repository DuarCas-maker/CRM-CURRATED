"use client";
import type { Locale } from "@/lib/domain";
import { t } from "./ui";

export function CompanyApplicationActions({
  locale,
  revision,
  generatedRevision,
  dirty,
  busy,
  saveDisabled,
  generateDisabled,
  save,
  generate,
}: {
  locale: Locale;
  revision: number;
  generatedRevision: number | null;
  dirty: boolean;
  busy: boolean;
  saveDisabled: boolean;
  generateDisabled: boolean;
  save: () => void;
  generate: () => void;
}) {
  const needsSave = dirty || revision === 0;
  const currentPdf = !needsSave && generatedRevision === revision;
  return (
    <div className="modal-footer application-actions" aria-busy={busy}>
      {generatedRevision !== null && (
        <span className="muted" role="status">
          {currentPdf
            ? t(locale, "PDF generado", "PDF generated")
            : t(
                locale,
                "PDF anterior · pendiente de actualizar",
                "Previous PDF · update required",
              )}
        </span>
      )}
      <button
        className={needsSave ? "button" : "button primary"}
        disabled={busy || (needsSave ? saveDisabled : generateDisabled)}
        onClick={needsSave ? save : generate}
      >
        {needsSave
          ? t(locale, "Guardar aplicación", "Save application")
          : currentPdf
            ? t(locale, "Generar otro PDF", "Generate another PDF")
            : t(locale, "Generar PDF e incorporar", "Generate PDF and attach")}
      </button>
    </div>
  );
}
