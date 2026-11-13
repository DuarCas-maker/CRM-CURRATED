import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { pipelineModuleDemo } from "../src/lib/pipeline-os/demo";
import { buildPipelineBoard } from "../src/lib/pipeline-os/module";
import {
  PipelineTable,
  PipelineUpdates,
} from "../src/components/pipeline-os/board";

test("standalone module renders both languages, a real navigation control and an explicit synthetic-data marker", async () => {
  const hook = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "", shortCircuit: true }
        : next(url, context);
    },
  });
  const { PipelineOSWorkspace } =
    await import("../src/components/pipeline-os/workspace");
  hook.deregister();
  for (const locale of ["es", "en"] as const) {
    const { data, processes } = pipelineModuleDemo();
    data.preferences.locale = locale;
    const html = renderToStaticMarkup(
      createElement(PipelineOSWorkspace, {
        initial: data,
        initialBoard: buildPipelineBoard(data, processes),
        processes,
      }),
    );
    assert(html.includes('aria-controls="pos-tree"'));
    assert(html.includes('aria-expanded="false"'));
    assert(html.includes(locale === "es" ? "datos ficticios" : "sample data"));
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    assert(html.includes('href="#pos-main"'));
    assert(html.includes("Pipeline OS"));
  }
});
test("tables identify no-result states and reports never claim they executed a Gmail scan", () => {
  const { data } = pipelineModuleDemo();
  const board = buildPipelineBoard(data, [], { q: "no such customer" });
  const html = renderToStaticMarkup(
    createElement(PipelineTable, {
      board,
      group: "files",
      locale: "es",
      open() {},
      mail() {},
      busy: false,
    }),
  );
  assert(html.includes("No hay expedientes"));
  const report = renderToStaticMarkup(
    createElement(PipelineUpdates, {
      board,
      locale: "en",
      open() {},
      mode: "updates",
    }),
  );
  assert(report.includes("does not run a new Gmail scan"));
});

test("first workspace render matches across server/client time zones near UTC midnight in both languages", async () => {
  const hook = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "", shortCircuit: true }
        : next(url, context);
    },
  });
  const { PipelineOSWorkspace } =
    await import("../src/components/pipeline-os/workspace");
  hook.deregister();
  const previousZone = process.env.TZ;
  try {
    for (const locale of ["es", "en"] as const) {
      const { data, processes } = pipelineModuleDemo();
      data.preferences.locale = locale;
      const initialBoard = {
        ...buildPipelineBoard(data, processes),
        asOf: "2026-11-13T04:00:00.000Z",
      };
      const markup = (zone: string) => {
        process.env.TZ = zone;
        return renderToStaticMarkup(
          createElement(PipelineOSWorkspace, {
            initial: data,
            initialBoard,
            processes,
          }),
        );
      };
      const server = markup("UTC");
      for (const zone of ["America/Bogota", "America/New_York", "Asia/Tokyo"]) {
        const client = markup(zone);
        assert.equal(
          createHash("sha256").update(client).digest("hex"),
          createHash("sha256").update(server).digest("hex"),
          `${locale} ${zone}: server=${server.match(/pos-subtitle[^>]*>(.*?)<\/p>/)?.[1]} client=${client.match(/pos-subtitle[^>]*>(.*?)<\/p>/)?.[1]}`,
        );
      }
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});
