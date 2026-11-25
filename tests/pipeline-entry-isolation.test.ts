import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
if (!process.execArgv.includes("--experimental-test-module-mocks")) {
  test("Pipeline entry remains accessible when the mail board is unavailable", () => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = execFileSync(process.execPath, ["--import", "./tests/offline.mjs", "--import", "tsx", "--experimental-test-module-mocks", "--test", "tests/pipeline-entry-isolation.test.ts"], { env, encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.match(result, /# fail 0/);
  });
} else {
  test("real page isolates a failed mail-history board and retains auth redirects", async () => {
    (globalThis as any).React = await import("react");
    let boardCalls = 0, workspaceCalls = 0, available = true, forbidden = false;
    class HttpError extends Error { constructor(public status: number) { super("fixture"); } }
    const initial = { fixture: true };
    const component = () => null;
    const mocks = [
      mock.module("../src/lib/server/supabase.ts", { namedExports: { configured: () => available, HttpError } }),
      mock.module("../src/lib/server/workspace.ts", { namedExports: { loadWorkspace: async (params: URLSearchParams) => { workspaceCalls++; assert.equal(params.get("view"), "pipeline"); if (forbidden) throw new HttpError(403); return initial; } } }),
      mock.module("../src/lib/server/pipeline-os-module.ts", { namedExports: { loadPipelineBoard: async () => { boardCalls++; throw Error("fixture database timeout"); } } }),
      mock.module("../src/components/pipeline-os/workspace.tsx", { namedExports: { PipelineOSWorkspace: component } }),
      mock.module("next/navigation", { namedExports: { redirect: (url: string) => { throw Error("REDIRECT:" + url); } } }),
    ];
    try {
      const page = (await import("../src/app/pipeline-os/page")).default;
      const result = await page();
      assert.equal(result.type, component); assert.equal((result.props as any).initial, initial); assert.equal((result.props as any).initialBoard, undefined);
      assert.equal(boardCalls, 0); assert.equal(workspaceCalls, 1);
      forbidden = true; await assert.rejects(page(), /REDIRECT:\/login/);
      available = false; await assert.rejects(page(), /REDIRECT:\/login/);
      assert.equal(workspaceCalls, 2);
    } finally { for (const m of mocks) m.restore(); delete (globalThis as any).React; }
  });
}
