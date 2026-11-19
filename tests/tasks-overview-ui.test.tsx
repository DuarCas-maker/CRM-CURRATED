import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildTasksOverview } from "../src/lib/pipeline-os/tasks-overview";
import { tasksOverviewFixture, overviewNow } from "./fixtures/tasks-overview";

test("task overview renders accessible selection, per-account counts and all lead states in both languages", async () => {
  const hook = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "", shortCircuit: true }
        : next(url, context);
    },
  });
  const { TasksOverviewView } =
    await import("../src/components/pipeline-os/tasks-overview");
  hook.deregister();
  for (const locale of ["es", "en"] as const) {
    const props = {
      overview: buildTasksOverview(
        tasksOverviewFixture(),
        { owner: "santino" },
        overviewNow,
      ),
      locale,
      owner: "santino",
      account: "all",
      status: "all" as const,
      loading: false,
      error: "",
      selectOwner() {},
      changeStatus() {},
      changePage() {},
      refresh() {},
      open() {},
      onStage() {},
    };
    const html = renderToStaticMarkup(createElement(TasksOverviewView, props));
    assert(html.includes("Santino Ejemplo"));
    assert(html.includes("santino@team-two.example.test"));
    assert(html.includes('aria-pressed="true"'));
    assert(html.includes('scope="col"'));
    assert(
      html.includes(
        locale === "es" ? "Enviados · campañas" : "Sent · campaigns",
      ),
    );
    assert(html.includes(locale === "es" ? "Sin gestionar" : "Not contacted"));
    const waiting = renderToStaticMarkup(
      createElement(TasksOverviewView, { ...props, loading: true }),
    );
    assert(
      !waiting.includes("Negocio 000"),
      "obsolete lead detail must disappear while a new filter loads",
    );
    const error = renderToStaticMarkup(
      createElement(TasksOverviewView, { ...props, error: "failed" }),
    );
    assert(error.includes('role="alert"'));
    assert(error.includes(locale === "es" ? "Reintentar" : "Retry"));
    const empty = renderToStaticMarkup(
      createElement(TasksOverviewView, {
        ...props,
        overview: { ...props.overview, rows: [], total: 0 },
      }),
    );
    assert(
      empty.includes(
        locale === "es"
          ? "No hay leads con estos filtros"
          : "No leads match these filters",
      ),
    );
  }
});
