import { mkdir, open, readFile, rename, unlink, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { S00RunError } from "./s00-composio-common";
import {
  assertInstantlyTransition,
  type InstantlyStore,
} from "./s00-instantly-runner";
import {
  assertInstantlyRecoveryTransition,
  validateInstantlyLedger,
  type InstantlyLedgerStore,
} from "./s00-instantly-recovery";
import {
  assertBTransition,
  validateBState,
  type BState,
  type BStore,
  type BInputs,
} from "./s00-instantly-b";
import type { InstantlyLedger } from "./s00-instantly-recovery";
import {
  assertBDTransition,
  validateBDState,
  type BDState,
  type BDStore,
  type BDInputs,
} from "./s00-instantly-b-diagnostic";

const fail = (code: string): never => {
  throw new S00RunError(code);
};
const maximum = 65_536;
export function instantlyFiles(root: string) {
  const folder = resolve(root, ".local/pipeline-os"),
    path = resolve(folder, "s00-instantly-run.json");
  const allStore: {
    load(): Promise<InstantlyLedger | BState | BDState | undefined>;
    save(s: InstantlyLedger | BState | BDState): Promise<void>;
  } = {
    async load() {
      let text: string;
      try {
        const metadata = await lstat(path);
        if (
          !metadata.isFile() ||
          metadata.isSymbolicLink() ||
          metadata.size > maximum
        )
          fail("INVALID_INSTANTLY_JOURNAL_SIZE");
        text = await readFile(path, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        return fail("INSTANTLY_JOURNAL_READ_FAILED");
      }
      if (Buffer.byteLength(text) > maximum)
        fail("INVALID_INSTANTLY_JOURNAL_SIZE");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return fail("INVALID_INSTANTLY_JOURNAL_JSON");
      }
      const validated =
        parsed &&
        typeof parsed === "object" &&
        "version" in parsed &&
        parsed.version === 4
          ? validateBDState(parsed)
          : parsed &&
              typeof parsed === "object" &&
              "version" in parsed &&
              parsed.version === 3
            ? validateBState(parsed)
            : validateInstantlyLedger(parsed);
      // Strict non-coercing validation above; preserve saved-file serialization order.
      return parsed as typeof validated;
    },
    async save(state) {
      const previous = await allStore.load();
      if (state.version === 4) {
        if (previous && previous.version !== 3 && previous.version !== 4)
          return fail("BD_SOURCE_REQUIRED");
        assertBDTransition(previous, state);
      } else if (previous?.version === 4) return fail("BD_LEDGER_SUPERSEDES_B");
      else if (state.version === 3) {
        if (previous?.version === 1) return fail("B_SOURCE_REQUIRED");
        assertBTransition(previous, state);
      } else if (previous?.version === 3) return fail("B_LEDGER_SUPERSEDES_A");
      else if (state.version === 2)
        assertInstantlyRecoveryTransition(previous, state);
      else {
        if (previous?.version === 2)
          return fail("INSTANTLY_RECOVERY_LEDGER_SUPERSEDES_V1");
        assertInstantlyTransition(previous, state);
      }
      const text = JSON.stringify(state, null, 2) + "\n";
      if (Buffer.byteLength(text) > maximum)
        fail("INVALID_INSTANTLY_JOURNAL_SIZE");
      // Exclusive temp creation preserves a stale/foreign temp for explicit recovery.
      const file = await open(path + ".tmp", "wx", 0o600);
      try {
        await file.writeFile(text);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(path + ".tmp", path);
    },
  };
  const ledgerStore: InstantlyLedgerStore = {
    async load() {
      const s = await allStore.load();
      if (s?.version === 4) return fail("BD_LEDGER_SUPERSEDES_B");
      if (s?.version === 3) return fail("B_LEDGER_SUPERSEDES_A");
      return s;
    },
    save: (s) => allStore.save(s),
  };
  const bStore: BStore = {
    async load() {
      const s = await allStore.load();
      if (s?.version === 4) return fail("BD_LEDGER_SUPERSEDES_B");
      if (s?.version === 1) return fail("B_SOURCE_REQUIRED");
      return s;
    },
    save: (s) => allStore.save(s),
  };
  const store: InstantlyStore = {
    async load() {
      const state = await ledgerStore.load();
      if (state?.version === 2)
        return fail("INSTANTLY_RECOVERY_LEDGER_SUPERSEDES_V1");
      return state;
    },
    save: (state) => ledgerStore.save(state),
  };
  const diagnosticStore: BDStore = {
    async load() {
      const s = await allStore.load();
      if (s?.version === 1 || s?.version === 2)
        return fail("BD_SOURCE_REQUIRED");
      return s;
    },
    save: (s) => allStore.save(s),
  };
  const input = async (name: string) => {
    try {
      const target = resolve(folder, name),
        metadata = await lstat(target);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size > maximum
      )
        throw Error();
      const text = await readFile(target, "utf8");
      if (Buffer.byteLength(text) > maximum) throw Error();
      return JSON.parse(text) as unknown;
    } catch {
      return fail("B_INPUT_FILE_INVALID_OR_MISSING");
    }
  };
  return {
    store,
    ledgerStore,
    allStore,
    bStore,
    diagnosticStore,
    async bInputs(): Promise<BInputs> {
      const s = await allStore.load();
      if (!s || s.version === 1) return fail("B_SOURCE_REQUIRED");
      return {
        prior: s.version === 4 ? s.prior.prior : s.version === 3 ? s.prior : s,
        scope: await input("s00-instantly-scope-attestation.json"),
        manifest: await input("s00-instantly-b-manifest.json"),
      };
    },
    async diagnosticInputs(): Promise<BDInputs> {
      const s = await diagnosticStore.load();
      if (!s) return fail("BD_SOURCE_REQUIRED");
      return {
        source: s.version === 4 ? s.prior : s,
        scope: await input("s00-instantly-scope-attestation.json"),
        manifest: await input("s00-instantly-b-manifest.json"),
      };
    },
    async locked<T>(work: () => Promise<T>) {
      await mkdir(folder, { recursive: true });
      let file: Awaited<ReturnType<typeof open>>;
      try {
        file = await open(path + ".lock", "wx", 0o600);
      } catch {
        return fail("INSTANTLY_JOURNAL_LOCKED");
      }
      try {
        return await work();
      } finally {
        await file.close();
        await unlink(path + ".lock");
      }
    },
  };
}
