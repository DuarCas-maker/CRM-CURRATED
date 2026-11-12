import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Modal } from "../src/components/ui";

function dialogNames(markup: string) {
  return [...markup.matchAll(/<dialog\b([^>]*)>([\s\S]*?)<\/dialog>/g)].map(
    ([, attributes, content]) => {
      const label = /aria-labelledby="([^"]+)"/.exec(attributes)?.[1];
      assert.ok(label, "Every shared dialog must reference its visible title");
      const heading = [...content.matchAll(/<h2\b([^>]*)>(.*?)<\/h2>/g)].find(
        ([, attrs]) => /id="([^"]+)"/.exec(attrs)?.[1] === label,
      );
      assert.ok(
        heading,
        "The accessible label must resolve to this dialog's h2",
      );
      return { id: label, name: heading[2] };
    },
  );
}

test("shared modal exposes its visible Spanish title as its accessible name", () => {
  const markup = renderToStaticMarkup(
    <Modal title="Revisión documental" close={() => {}}>
      <p>Contenido de prueba</p>
    </Modal>,
  );
  assert.deepEqual(
    dialogNames(markup).map((d) => d.name),
    ["Revisión documental"],
  );
});

test("multiple shared modals keep unique title references in both languages", () => {
  const markup = renderToStaticMarkup(
    <>
      <Modal title="Nueva tarea" close={() => {}}>
        <p>Primera ventana</p>
      </Modal>
      <Modal title="Document review" locale="en" close={() => {}}>
        <p>Second window</p>
      </Modal>
    </>,
  );
  const names = dialogNames(markup);
  assert.equal(new Set(names.map((d) => d.id)).size, 2);
  assert.deepEqual(
    names.map((d) => d.name),
    ["Nueva tarea", "Document review"],
  );
  assert.match(markup, /aria-label="Close"/);
});
