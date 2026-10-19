import test from "node:test";
import assert from "node:assert/strict";
import {
  callUnderwritingProvider,
  UnderwritingProviderError,
  UNDERWRITING_STREAM_TIMEOUT_MS,
} from "../src/lib/server/openai-underwriting";

const body = {
  model: "fixture",
  input: [],
  store: false,
  stream: true,
  text: {},
  max_output_tokens: 16000,
};
const accepted = {
  type: "response.created",
  response: { id: "resp_stream_fixture", status: "in_progress" },
};
const completed = {
  type: "response.completed",
  response: {
    id: "resp_stream_fixture",
    status: "completed",
    usage: { input_tokens: 100, output_tokens: 25 },
    output: [
      {
        type: "message",
        content: [
          { type: "output_text", text: JSON.stringify({ note: "Revisión ✓" }) },
        ],
      },
    ],
  },
};
function sse(events: unknown[], chunkSize = 11) {
  const bytes = new TextEncoder().encode(
    events
      .map((e) => `event: test\r\ndata: ${JSON.stringify(e)}\r\n\r\n`)
      .join(""),
  );
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, (offset += chunkSize)));
      },
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}
test("underwriting gives streamed analysis 15 minutes and accepts only the terminal report across split UTF-8/SSE frames", async (t) => {
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal),
    timeouts: number[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    timeouts.push(ms);
    return originalTimeout(ms);
  });
  let calls = 0;
  const result = await callUnderwritingProvider(
    body,
    "fixture-only",
    async (_url, init) => {
      calls++;
      const sent = JSON.parse(String(init?.body));
      assert.equal(sent.stream, true);
      assert.equal(sent.store, false);
      assert.equal(sent.max_output_tokens, 16000);
      return sse(
        [
          accepted,
          { type: "response.output_text.delta", delta: '{"private_partial":' },
          completed,
        ],
        1,
      );
    },
  );
  assert.deepEqual(result.value, { note: "Revisión ✓" });
  assert.equal(result.responseId, "resp_stream_fixture");
  assert.equal(result.inputTokens, 100);
  assert.equal(result.outputTokens, 25);
  assert.equal(calls, 1);
  assert.equal(UNDERWRITING_STREAM_TIMEOUT_MS, 900000);
  assert.deepEqual(timeouts, [900000]);
});
test("streamed incomplete reports retain their token reason and usage without accepting partial output", async () => {
  await assert.rejects(
    callUnderwritingProvider(body, "fixture-only", async () =>
      sse([
        accepted,
        {
          type: "response.incomplete",
          response: {
            id: "resp_stream_fixture",
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            usage: { input_tokens: 100, output_tokens: 16000 },
            output: [
              { content: [{ type: "output_text", text: '{"incomplete":' }] },
            ],
          },
        },
      ]),
    ),
    (e) => {
      assert(e instanceof UnderwritingProviderError);
      assert.equal(e.code, "OPENAI_OUTPUT_LIMIT_REACHED");
      assert.equal(e.diagnostics?.outputTokens, 16000);
      assert.equal(e.uncertain, false);
      return true;
    },
  );
});
test("a closed stream preserves the accepted response id and never promotes plausible partial JSON", async () => {
  let calls = 0;
  await assert.rejects(
    callUnderwritingProvider(body, "fixture-only", async () => {
      calls++;
      return sse([
        accepted,
        { type: "response.output_text.delta", delta: '{"ok":true}' },
      ]);
    }),
    (e) => {
      assert(e instanceof UnderwritingProviderError);
      assert.equal(e.code, "OPENAI_STREAM_INTERRUPTED");
      assert.equal(e.diagnostics?.responseId, "resp_stream_fixture");
      assert(e.uncertain);
      return true;
    },
  );
  assert.equal(calls, 1);
});
test("provider stream errors reveal no raw provider text and remain uncertain", async () => {
  await assert.rejects(
    callUnderwritingProvider(body, "fixture-only", async () =>
      sse([accepted, { type: "error", message: "private-provider-message" }]),
    ),
    (e) => {
      assert(e instanceof UnderwritingProviderError);
      assert.equal(e.code, "OPENAI_STREAM_INTERRUPTED");
      assert(e.uncertain);
      assert(!JSON.stringify(e).includes("private-provider-message"));
      return true;
    },
  );
});
test("timeout before headers or during streaming is classified separately and never repeats the request", async () => {
  // AbortSignal.timeout uses an unref'ed timer; keep this controlled fixture alive.
  const keepAlive = setTimeout(() => {}, 500);
  try {
    for (const duringStream of [false, true]) {
      let calls = 0;
      await assert.rejects(
        callUnderwritingProvider(
          body,
          "fixture-only",
          async (_url, init) => {
            calls++;
            const signal = init!.signal!;
            if (!duringStream)
              return new Promise<Response>((_resolve, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), {
                  once: true,
                }),
              );
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      `data: ${JSON.stringify(accepted)}\n\n`,
                    ),
                  );
                  signal.addEventListener(
                    "abort",
                    () => controller.error(signal.reason),
                    { once: true },
                  );
                },
              }),
              { headers: { "content-type": "text/event-stream" } },
            );
          },
          { timeoutMs: 10 },
        ),
        (e) => {
          assert(e instanceof UnderwritingProviderError);
          assert.equal(e.code, "OPENAI_RESPONSE_TIMEOUT");
          assert(e.uncertain);
          if (duringStream)
            assert.equal(e.diagnostics?.responseId, "resp_stream_fixture");
          return true;
        },
      );
      assert.equal(calls, 1);
    }
  } finally {
    clearTimeout(keepAlive);
  }
});
