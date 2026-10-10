import test from "node:test";
import assert from "node:assert/strict";
import config from "../next.config";

test("OAuth form redirects permit Google while other external form destinations remain excluded", async () => {
  const rules = await config.headers!();
  const globalRule = rules.find((rule) => rule.source === "/:path*");
  const policy = globalRule?.headers.find(
    (header) => header.key === "Content-Security-Policy",
  )?.value;
  assert.ok(policy);
  const directives = new Map(
    policy.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
  assert.deepEqual(directives.get("form-action"), [
    "'self'",
    "https://accounts.google.com",
  ]);
  assert.deepEqual(directives.get("default-src"), ["'self'"]);
  assert.deepEqual(directives.get("base-uri"), ["'self'"]);
  assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
  assert.ok(
    !directives.get("connect-src")?.includes("https://accounts.google.com"),
    "Google authorization needs navigation, not access to its content through fetch",
  );
});
