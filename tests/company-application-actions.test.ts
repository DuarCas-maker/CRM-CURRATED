import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyApplicationActions } from "../src/components/company-application-actions";

function render(
  props: Partial<ComponentProps<typeof CompanyApplicationActions>> = {},
) {
  const html = renderToStaticMarkup(
    createElement(CompanyApplicationActions, {
      locale: "es",
      revision: 0,
      generatedRevision: null,
      dirty: false,
      busy: false,
      saveDisabled: false,
      generateDisabled: false,
      save: () => {},
      generate: () => {},
      ...props,
    }),
  );
  assert.equal((html.match(/<button\b/g) || []).length, 1);
  return { html, button: html.match(/<button\b[^>]*>.*?<\/button>/)![0] };
}

test("new and edited applications expose only the existing save action and color", () => {
  for (const props of [
    {},
    { revision: 1, dirty: true },
    { revision: 1, generatedRevision: 1, dirty: true },
  ]) {
    const { button } = render(props);
    assert.match(button, /class="button"/);
    assert.match(button, />Guardar aplicación<\/button>/);
    assert.doesNotMatch(button, /disabled/);
  }
});

test("saved versions with no current PDF expose the existing generation action and color", () => {
  for (const generatedRevision of [null, 1]) {
    const { button } = render({ revision: 2, generatedRevision });
    assert.match(button, /class="button primary"/);
    assert.match(button, />Generar PDF e incorporar<\/button>/);
    assert.doesNotMatch(button, /disabled/);
  }
});

test("a confirmed PDF revision restores the repeat action and places its status before the button", () => {
  const { html, button } = render({ revision: 2, generatedRevision: 2 });
  assert.match(button, />Generar otro PDF<\/button>/);
  assert.match(html, /role="status">PDF generado<\/span>/);
  assert(html.indexOf("PDF generado") < html.indexOf("<button"));
});

test("editing or saving a newer version identifies the previous PDF as requiring an update", () => {
  for (const props of [
    { revision: 1, generatedRevision: 1, dirty: true },
    { revision: 2, generatedRevision: 1 },
  ]) {
    const { html } = render(props);
    assert.match(html, /PDF anterior · pendiente de actualizar/);
    assert.doesNotMatch(html, />PDF generado<|Generar otro PDF/);
  }
});

test("pending operations retain the action label, and signature and owner checks still gate the relevant action", () => {
  for (const props of [
    { busy: true },
    { revision: 1, busy: true },
    { revision: 1, generatedRevision: 1, busy: true },
    { saveDisabled: true },
    { revision: 1, generateDisabled: true },
  ]) {
    assert.match(render(props).button, /disabled/);
  }
  // An incomplete application can still be saved as a draft.
  assert.doesNotMatch(render({ generateDisabled: true }).button, /disabled/);
});

test("English retains all three actions and distinguishes current and previous PDFs", () => {
  assert.match(render({ locale: "en" }).button, />Save application<\/button>/);
  assert.match(
    render({ locale: "en", revision: 1 }).button,
    />Generate PDF and attach<\/button>/,
  );
  const generated = render({ locale: "en", revision: 1, generatedRevision: 1 });
  assert.match(generated.button, />Generate another PDF<\/button>/);
  assert.match(generated.html, />PDF generated<\/span>/);
  assert.match(
    render({ locale: "en", revision: 2, generatedRevision: 1 }).html,
    /Previous PDF · update required/,
  );
});
