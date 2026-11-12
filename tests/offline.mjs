// Test-only guard. Individual tests may replace fetch with their own fake ports.
// No credentials or operational .local files are needed to run the suite.
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  const input = args[0];
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("QA_OFFLINE_FETCH_BLOCKED");
  }
  return originalFetch(...args);
};
