import { readFile } from "node:fs/promises";
import { parseArgs, parseEnv } from "node:util";
import { inspectS00Environment, validateS00Campaign } from "./s00-contract";

async function main() {
  const { values } = parseArgs({
    options: {
      "config-env": { type: "string" },
      campaign: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  // Deliberately no process.env merging, dotenv autoload or network mode.
  const environment = values["config-env"]
    ? parseEnv(await readFile(values["config-env"], "utf8"))
    : {};
  const campaign = values.campaign
    ? validateS00Campaign(JSON.parse(await readFile(values.campaign, "utf8")))
    : { valid: false, issueCodes: ["campaign_not_supplied"] };
  console.log(
    JSON.stringify(
      {
        ...inspectS00Environment(environment),
        campaignContract: campaign,
        campaignChecksAreOfflineOnly: true,
      },
      null,
      2,
    ),
  );
  if (!campaign.valid) process.exitCode = 2;
}

main().catch(() => {
  // Filenames, parse errors and exception stacks can contain private values.
  console.error(
    JSON.stringify({ error: "S00_PREFLIGHT_INPUT_ERROR", networkCalls: 0 }),
  );
  process.exitCode = 1;
});
