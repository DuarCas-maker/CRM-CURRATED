// Keep offline SQL fixtures out of release logs; preserve the test runner's exit status.
export default async function* report(source) {
  for await (const event of source) {
    if (event.type === "test:fail")
      yield JSON.stringify({
        failed: event.data.name,
        error: String(event.data.details?.error?.message || "")
          .split("\n")[0]
          .slice(0, 140),
      }) + "\n";
    if (
      event.type === "test:diagnostic" &&
      /^(tests|pass|fail|skipped|duration_ms) /.test(event.data.message)
    )
      yield event.data.message + "\n";
  }
}
