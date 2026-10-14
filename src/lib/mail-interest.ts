import { readableMail } from "./mail-display";

// The cutoff is based on receipt time, never import or deployment time.
export const MAIL_ENGAGEMENT_START = "2026-10-13T05:00:00.000Z";
export type ReplyIntent = "positive" | "negative" | "review" | "ignored";

export function automatedSender(email: string) {
  return /^(?:mailer-daemon|postmaster|no[._-]?reply|do[._-]?not[._-]?reply|bounce(?:s)?(?:[+._-][^@]*)?)@/i.test(
    email.trim(),
  );
}

// Deliberately conservative: unknown language/wording goes to human review.
// Only the author's new text is evidence; quoted campaigns and subjects are not.
export function replyIntent(message: {
  direction: string;
  nature?: string;
  sender?: string;
  body: string;
}): ReplyIntent {
  if (
    message.direction !== "inbound" ||
    message.nature !== "personal" ||
    automatedSender(message.sender || "")
  )
    return "ignored";
  const text = readableMail(message.body)
    .text.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase();
  if (
    /\b(?:out of (?:the )?office|automatic reply|auto[ -]?reply|respuesta automatica|fuera de (?:la )?oficina|estoy de vacaciones)\b/.test(
      text,
    )
  )
    return "ignored";
  const negativePattern =
    /\b(?:not interested|no (?:estoy|estamos|me encuentro) interesad[oa]s?|no (?:me|nos) interesa|ya no (?:necesito|necesitamos|quiero|queremos)|no (?:necesito|necesitamos|quiero|queremos) (?:un |el |mas )?(?:prestamo|credito|financiamiento|financiacion)|do not contact|don't contact|stop (?:emailing|contacting)|remove me|unsubscribe|darme de baja|no (?:me|nos) (?:contactes|contacten|escribas|escriban))\b/g;
  const negative = !!text.match(negativePattern);
  const positiveText = text.replace(negativePattern, "");
  const positive =
    /\b(?:(?:send|email|share) (?:me|us) (?:some |more |the )?(?:info(?:rmation)?|details|rates|terms|application)|(?:can|could) you (?:send|share|email) (?:me |us )?(?:info(?:rmation)?|details|rates|terms)|(?:enviame|envienme|mandame|mandenme|comparteme|compartanme|enviar|mandar) (?:mas |la |las |los )?(?:informacion|detalles|tasas|requisitos|solicitud)|(?:puedes|pueden|podrias|podrian) (?:enviarme|mandarme|compartirme) (?:mas |la )?(?:informacion|detalles|tasas|requisitos)|(?:what|which) (?:are (?:your|the) |interest )?(?:rates|terms|requirements)|(?:que|cuales) (?:son (?:sus|las|los) )?(?:tasas|requisitos|condiciones)|(?:i(?:'m| am)|we(?:'re| are)) interested|(?:estoy|estamos) interesad[oa]s?|(?:i|we) (?:want|would like|need) (?:to apply|to proceed|to move forward|a loan|funding|financing)|(?:quiero|queremos|quisiera|necesito|necesitamos) (?:aplicar|avanzar|solicitar|un prestamo|un credito|financiamiento|financiacion)|(?:call|contact|reach out to) (?:me|us)|(?:llamame|llamenme|contactame|contactenme|hablame|hablenme)|(?:here|attached) (?:are|is) (?:my|our|the) (?:documents|statements|application)|(?:adjunto|anexo|estos son) (?:mis |los |nuestros )?(?:documentos|estados|solicitud))\b/.test(
      positiveText,
    );
  if (negative && positive) return "review";
  if (negative) return "negative";
  // Negated requests must never be mistaken for interest or a definitive rejection.
  if (
    /\b(?:don't|do not|no|not)\b[^.!?,;\n]{0,30}\b(?:send|call|apply|interested|envi|llam|aplicar|interes)/.test(
      text,
    )
  )
    return "review";
  return positive ? "positive" : "review";
}
