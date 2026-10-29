import {
  assertCTransition,
  validateCState,
  validateCInputs,
  type CState,
  type CStore,
  type CInputs,
} from "./s00-instantly-c";
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
import {
  assertBRTransition,
  validateBRState,
  type BRState,
  type BRStore,
  type BRInputs,
} from "./s00-instantly-b-recovery";
import {
  assertCFDTransition,
  validateCFDState,
  type CFDState,
  type CFDStore,
  type CFDInputs,
} from "./s00-instantly-config-diagnostic";
import {
  assertBR28Transition,
  validateBR28State,
  type BR28State,
  type BR28Store,
  type BR28Inputs,
} from "./s00-instantly-b-recovery-from-28";

const fail = (code: string): never => {
  throw new S00RunError(code);
};
const maximum = 65_536;
export function instantlyFiles(root: string) {
  const folder = resolve(root, ".local/pipeline-os"),
    path = resolve(folder, "s00-instantly-run.json");
  const allStore: {
    load(): Promise<
      | InstantlyLedger
      | BState
      | BDState
      | BRState
      | CFDState
      | BR28State
      | CState
      | undefined
    >;
    save(
      s:
        | InstantlyLedger
        | BState
        | BDState
        | BRState
        | CFDState
        | BR28State
        | CState,
    ): Promise<void>;
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
        parsed.version === 8
          ? validateCState(parsed)
          : parsed &&
              typeof parsed === "object" &&
              "version" in parsed &&
              parsed.version === 7
            ? validateBR28State(parsed)
            : parsed &&
                typeof parsed === "object" &&
                "version" in parsed &&
                parsed.version === 6
              ? validateCFDState(parsed)
              : parsed &&
                  typeof parsed === "object" &&
                  "version" in parsed &&
                  parsed.version === 5
                ? validateBRState(parsed)
                : parsed &&
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
      if (state.version === 8) {
        if (previous && previous.version !== 7 && previous.version !== 8)
          return fail("C_SOURCE_REQUIRED");
        assertCTransition(previous, state);
      } else if (previous?.version === 8)
        return fail("C_LEDGER_SUPERSEDES_BR28");
      else if (state.version === 7) {
        if (previous && previous.version !== 6 && previous.version !== 7)
          return fail("BR28_SOURCE_REQUIRED");
        assertBR28Transition(previous, state);
      } else if (previous?.version === 7)
        return fail("BR28_LEDGER_SUPERSEDES_CFD");
      else if (state.version === 6) {
        if (previous && previous.version !== 5 && previous.version !== 6)
          return fail("CFD_SOURCE_REQUIRED");
        assertCFDTransition(previous, state);
      } else if (previous?.version === 6)
        return fail("CFD_LEDGER_SUPERSEDES_BR");
      else if (state.version === 5) {
        if (previous && previous.version !== 4 && previous.version !== 5)
          return fail("BR_SOURCE_REQUIRED");
        assertBRTransition(previous, state);
      } else if (previous?.version === 5)
        return fail("BR_LEDGER_SUPERSEDES_BD");
      else if (state.version === 4) {
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
      if (s?.version === 8) return fail("C_LEDGER_SUPERSEDES_BR28");
      if (s?.version === 7) return fail("BR28_LEDGER_SUPERSEDES_CFD");
      if (s?.version === 6) return fail("CFD_LEDGER_SUPERSEDES_BR");
      if (s?.version === 5) return fail("BR_LEDGER_SUPERSEDES_BD");
      if (s?.version === 4) return fail("BD_LEDGER_SUPERSEDES_B");
      if (s?.version === 3) return fail("B_LEDGER_SUPERSEDES_A");
      return s;
    },
    save: (s) => allStore.save(s),
  };
  const bStore: BStore = {
    async load() {
      const s = await allStore.load();
      if (s?.version === 8) return fail("C_LEDGER_SUPERSEDES_BR28");
      if (s?.version === 7) return fail("BR28_LEDGER_SUPERSEDES_CFD");
      if (s?.version === 6) return fail("CFD_LEDGER_SUPERSEDES_BR");
      if (s?.version === 5) return fail("BR_LEDGER_SUPERSEDES_BD");
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
      if (s?.version === 8) return fail("C_LEDGER_SUPERSEDES_BR28");
      if (s?.version === 7) return fail("BR28_LEDGER_SUPERSEDES_CFD");
      if (s?.version === 6) return fail("CFD_LEDGER_SUPERSEDES_BR");
      if (s?.version === 5) return fail("BR_LEDGER_SUPERSEDES_BD");
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
    cStore: {
      async load() {
        const s = await allStore.load();
        if (s && s.version !== 7 && s.version !== 8)
          return fail("C_SOURCE_REQUIRED");
        return s;
      },
      save: (s: CState) => allStore.save(s),
    } satisfies CStore,
    async cInputs(): Promise<CInputs> {
      const s = await allStore.load();
      if (!s || (s.version !== 7 && s.version !== 8))
        return fail("C_SOURCE_REQUIRED");
      const inputs = {
        source: s.version === 8 ? s.prior : s,
        scope: await input("s00-instantly-scope-attestation.json"),
        manifest: await input("s00-instantly-b-manifest.json"),
        receiver: await input("s00-instantly-c-manifest.json"),
      };
      const checked = validateCInputs(inputs);
      if (s.version === 8 && checked.receiverHash !== s.receiverHash)
        return fail("C_BINDING_CHANGED");
      return inputs;
    },
    bStore,
    diagnosticStore,
    br28Store: {
      async load() {
        const s = await allStore.load();
        if (s?.version === 8) return fail("C_LEDGER_SUPERSEDES_BR28");
        if (s && s.version !== 6 && s.version !== 7)
          return fail("BR28_SOURCE_REQUIRED");
        return s;
      },
      save: (s: BR28State) => allStore.save(s),
    } satisfies BR28Store,
    async br28Inputs(): Promise<BR28Inputs> {
      const s = await allStore.load();
      if (s?.version === 8) return fail("C_LEDGER_SUPERSEDES_BR28");
      if (!s || (s.version !== 6 && s.version !== 7))
        return fail("BR28_SOURCE_REQUIRED");
      return {
        source: s.version === 7 ? s.prior : s,
        scope: await input("s00-instantly-scope-attestation.json"),
        manifest: await input("s00-instantly-b-manifest.json"),
      };
    },
    cfdStore: {
      async load() {
        const s = await allStore.load();
        if (s?.version === 8) return fail("C_LEDGER_SUPERSEDES_BR28");
        if (s?.version === 7) return fail("BR28_LEDGER_SUPERSEDES_CFD");
        if (s && s.version !== 5 && s.version !== 6)
          return fail("CFD_SOURCE_REQUIRED");
        return s;
      },
      save: (s: CFDState) => allStore.save(s),
    } satisfies CFDStore,
    async cfdInputs(): Promise<CFDInputs> {
      const s = await allStore.load();
      if (s?.version === 8) return fail("C_LEDGER_SUPERSEDES_BR28");
      if (s?.version === 7) return fail("BR28_LEDGER_SUPERSEDES_CFD");
      if (!s || (s.version !== 5 && s.version !== 6))
        return fail("CFD_SOURCE_REQUIRED");
      return {
        source: s.version === 6 ? s.prior : s,
        scope: await input("s00-instantly-scope-attestation.json"),
        manifest: await input("s00-instantly-b-manifest.json"),
      };
    },
    brStore: {
      async load() {
        const s = await allStore.load();
        if (s?.version === 8) return fail("C_LEDGER_SUPERSEDES_BR28");
        if (s?.version === 7) return fail("BR28_LEDGER_SUPERSEDES_CFD");
        if (s?.version === 6) return fail("CFD_LEDGER_SUPERSEDES_BR");
        if (s && s.version !== 4 && s.version !== 5)
          return fail("BR_SOURCE_REQUIRED");
        return s;
      },
      save: (s: BRState) => allStore.save(s),
    } satisfies BRStore,
    async brInputs(): Promise<BRInputs> {
      const s = await allStore.load();
      if (s?.version === 8) return fail("C_LEDGER_SUPERSEDES_BR28");
      if (s?.version === 7) return fail("BR28_LEDGER_SUPERSEDES_CFD");
      if (s?.version === 6) return fail("CFD_LEDGER_SUPERSEDES_BR");
      if (!s || (s.version !== 4 && s.version !== 5))
        return fail("BR_SOURCE_REQUIRED");
      return {
        source: s.version === 5 ? s.prior : s,
        scope: await input("s00-instantly-scope-attestation.json"),
        manifest: await input("s00-instantly-b-manifest.json"),
      };
    },
    async bInputs(): Promise<BInputs> {
      const s = await allStore.load();
      if (s?.version === 8) return fail("C_LEDGER_SUPERSEDES_BR28");
      if (s?.version === 7) return fail("BR28_LEDGER_SUPERSEDES_CFD");
      if (s?.version === 6) return fail("CFD_LEDGER_SUPERSEDES_BR");
      if (s?.version === 5) return fail("BR_LEDGER_SUPERSEDES_BD");
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
