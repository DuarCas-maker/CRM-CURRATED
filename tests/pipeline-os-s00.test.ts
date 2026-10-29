import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  inspectS00Environment,
  validateS00Campaign,
} from "../scripts/pipeline-os/s00-contract";

function example(): Record<string, any> {
  return JSON.parse(
    readFileSync("docs/specs/pipeline-os/s00/campaign.example.json", "utf8"),
  );
}

test("S00 example validates but does not claim API or activation readiness", () => {
  assert.equal(validateS00Campaign(example()).valid, true);
  const inventory = inspectS00Environment({ COMPOSIO_API_KEY: "fixture-only" });
  assert.equal(inventory.networkCalls, 0);
  assert.equal(
    inventory.realApiReadiness,
    "unverified_requires_target_access_and_authorization",
  );
});

test("S00 rejects production and exceeding the agreed pilot", () => {
  for (const change of [
    (x: any) => {
      x.environment = "production";
    },
    (x: any) => {
      x.pilot.leadLimit = 501;
    },
    (x: any) => {
      x.pilot.brandIds.push("another-brand");
    },
    (x: any) => {
      x.pilot.mailboxIds[1] = x.pilot.mailboxIds[0];
    },
  ]) {
    const input = example();
    change(input);
    assert.equal(validateS00Campaign(input).valid, false);
  }
});

test("S00 requires explicit maxima, calendar and budgets without defaults", () => {
  for (const field of ["schedule", "budgets", "distribution"]) {
    const input = example();
    delete input[field];
    assert.equal(validateS00Campaign(input).valid, false);
  }
  for (const change of [
    (x: any) => {
      delete x.prospecting.maxTotalAttempts;
    },
    (x: any) => {
      x.prospecting.maxTotalAttempts = 0;
    },
    (x: any) => {
      x.interested.maxReminders = 0;
    },
    (x: any) => {
      x.budgets.dailySmsSegments = 0;
    },
    (x: any) => {
      x.schedule.weekdays = [];
    },
  ]) {
    const input = example();
    change(input);
    assert.equal(validateS00Campaign(input).valid, false);
  }
});

test("S00 preserves 48h/24h, global suppression, supervision and manual loyalty", () => {
  for (const change of [
    (x: any) => {
      x.prospecting.intervalHours = 24;
    },
    (x: any) => {
      x.interested.intervalHours = 4;
    },
    (x: any) => {
      x.prospecting.includesInitial = false;
    },
    (x: any) => {
      x.optOut = "brand_only";
    },
    (x: any) => {
      x.initialAssistantMode = "automatic";
    },
    (x: any) => {
      x.loyalty = "automatic_sms";
    },
  ]) {
    const input = example();
    change(input);
    assert.equal(validateS00Campaign(input).valid, false);
  }
});

test("S00 distribution rejects inconsistent percentages and ambiguous priorities", () => {
  const input = example();
  input.distribution.emailPercent = 70;
  assert.equal(validateS00Campaign(input).valid, false);
  input.distribution = {
    mode: "filters",
    unmatched: "hold_for_review",
    rules: [
      {
        channel: "email",
        field: "industry",
        values: ["fictional-industry"],
        priority: 1,
      },
      {
        channel: "sms",
        field: "state",
        values: ["fictional-state"],
        priority: 2,
      },
    ],
  };
  assert.equal(validateS00Campaign(input).valid, true);
  input.distribution.rules[1].priority = 1;
  assert.equal(validateS00Campaign(input).valid, false);
});

test("S00 checks timezone, unique weekdays and a usable sending window", () => {
  for (const change of [
    (x: any) => {
      x.schedule.timezone = "Invalid/NotAZone";
    },
    (x: any) => {
      x.schedule.weekdays = [1, 1];
    },
    (x: any) => {
      x.schedule.startHour = x.schedule.endHour;
    },
  ]) {
    const input = example();
    change(input);
    assert.equal(validateS00Campaign(input).valid, false);
  }
});

test("S00 inventory never prints credentials, mailbox identity, origins or malformed JSON", () => {
  const sentinel = "private-fixture-sentinel";
  const report = inspectS00Environment({
    COMPOSIO_API_KEY: sentinel,
    INSTANTLY_API_KEY: sentinel,
    TEXTTORRENT_API_SID: sentinel,
    TEXTTORRENT_API_PUBLIC_KEY: sentinel,
    NEXT_PUBLIC_SUPABASE_URL: `https://${sentinel}.invalid`,
    APP_ORIGIN: "http://localhost:3000",
    GOOGLE_OAUTH_ORGANIZATIONS: `invalid-json-${sentinel}`,
    UNKNOWN_PRIVATE_KEY: sentinel,
  });
  assert.equal(JSON.stringify(report).includes(sentinel), false);
  assert.equal(report.targets.supabase, "remote_unclassified_do_not_contact");
  assert.equal(report.targets.appOrigin, "loopback_unverified");
  assert.equal(report.googleOAuth.state, "invalid_json");
  assert.deepEqual(report.providerCredentialsPresent, {
    composio: true,
    instantly: true,
    texttorrent: true,
  });
});

test("S00 distinguishes absent, empty and unvalidated config without treating localhost as verified", () => {
  const report = inspectS00Environment({
    COMPOSIO_API_KEY: " ",
    GOOGLE_OAUTH_ORGANIZATIONS: "[]",
    NEXT_PUBLIC_SUPABASE_URL: "http://[::1]:54321",
    APP_ORIGIN: "file:///private-fixture",
    TEXTTORRENT_API_SID: "fixture-only",
  });
  assert.equal(report.presence.COMPOSIO_API_KEY, "empty");
  assert.equal(report.presence.INSTANTLY_API_KEY, "absent");
  assert.equal(report.googleOAuth.state, "empty_list");
  assert.equal(report.targets.supabase, "loopback_unverified");
  assert.equal(report.targets.appOrigin, "invalid");
  assert.equal(report.providerCredentialsPresent.texttorrent, false);
});

test("S00 errors expose only issue codes, never arbitrary input keys or values", () => {
  const input = example();
  input["private-fixture-sentinel"] = "private-fixture-sentinel";
  const result = validateS00Campaign(input);
  assert.equal(result.valid, false);
  assert.equal(
    JSON.stringify(result).includes("private-fixture-sentinel"),
    false,
  );
});

test("S00 CLI does not autoload env and redacts read/parse/argument failures", () => {
  const folder = mkdtempSync(join(tmpdir(), "pipeline-os-s00-"));
  const env = join(folder, "fixture.env"),
    bad = join(folder, "bad.json");
  try {
    writeFileSync(env, "COMPOSIO_API_KEY=private-fixture-sentinel\n");
    writeFileSync(bad, '{"private-fixture-sentinel":');
    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/pipeline-os/s00-preflight.ts", ...args],
        {
          encoding: "utf8",
          env: { ...process.env, COMPOSIO_API_KEY: "private-fixture-sentinel" },
        },
      );
    const sample = [
      "--campaign",
      "docs/specs/pipeline-os/s00/campaign.example.json",
    ];
    const absent = run(sample);
    assert.equal(absent.status, 0);
    assert.equal(JSON.parse(absent.stdout).presence.COMPOSIO_API_KEY, "absent");
    const supplied = run([...sample, "--config-env", env]);
    assert.equal(supplied.status, 0);
    assert.equal(
      JSON.parse(supplied.stdout).providerCredentialsPresent.composio,
      true,
    );
    for (const args of [
      ["--campaign", bad],
      ["--config-env", join(folder, "missing")],
      ["--probe", "private-fixture-sentinel"],
    ]) {
      const result = run(args);
      assert.equal(result.status, 1);
      assert.equal(
        JSON.stringify(result.stdout + result.stderr).includes(
          "private-fixture-sentinel",
        ),
        false,
      );
      assert.equal(
        JSON.parse(result.stderr).error,
        "S00_PREFLIGHT_INPUT_ERROR",
      );
    }
  } finally {
    unlinkSync(env);
    unlinkSync(bad);
    rmdirSync(folder);
  }
});
