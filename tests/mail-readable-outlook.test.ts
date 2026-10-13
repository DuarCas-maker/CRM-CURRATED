import test from "node:test";
import assert from "node:assert/strict";
import { readableMail } from "../src/lib/mail-display";
test("Outlook quoted history folds without changing the original email evidence", () => {
  const body =
    "Adjunto lo solicitado.\n________________________________\nFrom: Team <team@example.com>\nSent: Monday, October 12\nTo: Customer <customer@example.com>\nSubject: Re: Solicitud\n\nHistorial anterior completo.";
  const result = readableMail(body);
  assert.equal(result.text, "Adjunto lo solicitado.");
  assert.equal(result.folded, true);
  assert.equal(result.original, body);
});
test("a simple separator in an email never hides content without an actual quoted header block", () => {
  const body =
    "Documentos recibidos\n____________\nFrom: una nota del cliente\nContinuamos el proceso.";
  assert.equal(readableMail(body).text, body);
  assert.equal(readableMail(body).folded, false);
});
