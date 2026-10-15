import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ErrorPage from "../src/app/error";
import { checkDb, HttpError, jsonError } from "../src/lib/server/supabase";

test("workspace retry invokes Next's server refresh callback and shows only the error reference", () => {
  let retries = 0;
  const props = {
    error: Object.assign(new Error("private database detail"), {
      digest: "12345",
    }),
    retry: () => {
      retries++;
    },
  };
  const page = ErrorPage(props);
  const button = page.props.children.props.children.find(
    (child: { type?: string } | null) => child?.type === "button",
  );
  button.props.onClick();
  assert.equal(retries, 1);
  const html = renderToStaticMarkup(createElement(ErrorPage, props));
  assert.match(html, /12345/);
  assert(!html.includes("private database detail"));
});

test("database failures retain query context for server logs without adding it to API responses", async () => {
  const result = {
    data: null,
    error: { message: "Query failed", code: "57014" },
  };
  let caught: unknown;
  try {
    checkDb(result, "workspace_stats");
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof HttpError);
  assert.equal(caught.status, 400);
  assert.deepEqual(caught.cause, {
    operation: "workspace_stats",
    code: "57014",
  });
  assert.deepEqual(await jsonError(caught).json(), { error: "Query failed" });
  assert.equal(checkDb({ data: 42, error: null }, "workspace_stats"), 42);
});
