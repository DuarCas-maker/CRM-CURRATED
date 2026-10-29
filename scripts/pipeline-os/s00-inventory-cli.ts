import { parseArgs } from "node:util";
import { runS00Inventory } from "./s00-inventory";

async function main() {
  const { values } = parseArgs({
    options: { "execute-readonly": { type: "boolean", default: false } },
    strict: true,
    allowPositionals: false,
  });
  const result = await runS00Inventory(process.env, {
    executeReadonly: values["execute-readonly"],
  });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(() => {
  console.error(JSON.stringify({ error: "S00_INVENTORY_ERROR" }));
  process.exitCode = 1;
});
