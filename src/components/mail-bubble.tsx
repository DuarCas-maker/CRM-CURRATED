"use client";
import { readableMail } from "@/lib/mail-display";
import type { Locale } from "@/lib/domain";
import { t } from "./ui";
export function MailBody({ body, locale }: { body: string; locale: Locale }) {
  const display = readableMail(body);
  return (
    <div className="mail-readable">
      <p>
        {display.text ||
          t(
            locale,
            "Este correo contiene únicamente contenido citado o una firma. Abre el contenido completo.",
            "This email contains only quoted content or a signature. Open the complete content.",
          )}
      </p>
      {display.folded && (
        <details>
          <summary>
            {t(
              locale,
              "Ver contenido completo · firma e historial citado",
              "View full content · signature and quoted history",
            )}
          </summary>
          <pre>{body}</pre>
        </details>
      )}
    </div>
  );
}
